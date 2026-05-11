// Transcribe an uploaded voice message.
// Routes large files (>24MB) to Deepgram (no size cap), small files to OpenAI Whisper (25MB cap).
// Falls back to OpenAI if Deepgram is not configured.
// deno-lint-ignore-file no-explicit-any
import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const OPENAI_LIMIT_BYTES = 25 * 1024 * 1024;
// Use Deepgram a touch below OpenAI's hard cap to avoid edge cases.
const OPENAI_SAFE_BYTES = 24 * 1024 * 1024;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const openaiKey = Deno.env.get("OPENAI_API_KEY");
    const deepgramKey = Deno.env.get("DEEPGRAM_API_KEY");
    if (!openaiKey && !deepgramKey) {
      throw new Error("Neither OPENAI_API_KEY nor DEEPGRAM_API_KEY is configured");
    }

    const authHeader = req.headers.get("Authorization") ?? "";
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { messageId, audioPath } = await req.json();
    if (!messageId || !audioPath) throw new Error("messageId and audioPath required");

    // Sign the audio URL so we can either download it (OpenAI) or hand it to Deepgram.
    const { data: signed, error: signErr } = await supabase.storage
      .from("voice-messages")
      .createSignedUrl(audioPath, 60 * 10);
    if (signErr || !signed) throw signErr ?? new Error("Could not sign url");

    // Probe size with a HEAD request so we can pick a provider without downloading.
    let sizeBytes = 0;
    try {
      const headRes = await fetch(signed.signedUrl, { method: "HEAD" });
      const len = headRes.headers.get("content-length");
      if (len) sizeBytes = parseInt(len, 10) || 0;
    } catch (_) {
      // ignore — we'll fall back to download path
    }

    const useDeepgram =
      !!deepgramKey && (sizeBytes === 0 || sizeBytes > OPENAI_SAFE_BYTES || !openaiKey);

    let transcript = "";

    if (useDeepgram) {
      console.log(`Using Deepgram (size=${sizeBytes} bytes)`);
      transcript = await transcribeWithDeepgram(signed.signedUrl, deepgramKey!);
    } else {
      if (sizeBytes > OPENAI_LIMIT_BYTES) {
        throw new Error(
          `Audio file is ${(sizeBytes / 1024 / 1024).toFixed(1)}MB which exceeds OpenAI Whisper's 25MB limit. Configure DEEPGRAM_API_KEY to enable larger files.`
        );
      }
      console.log(`Using OpenAI Whisper (size=${sizeBytes} bytes)`);
      transcript = await transcribeWithOpenAI(signed.signedUrl, audioPath, openaiKey!);
    }

    const { error: updateErr } = await supabase
      .from("messages")
      .update({ transcript })
      .eq("id", messageId);
    if (updateErr) throw updateErr;

    return new Response(JSON.stringify({ transcript }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("transcribe-voice error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

async function transcribeWithOpenAI(signedUrl: string, audioPath: string, apiKey: string): Promise<string> {
  const fileRes = await fetch(signedUrl);
  if (!fileRes.ok) throw new Error("Could not download audio");
  const audioBlob = await fileRes.blob();

  const ext = audioPath.split(".").pop()?.toLowerCase() || "webm";
  const form = new FormData();
  form.append("file", audioBlob, `voice.${ext}`);
  form.append("model", "whisper-1");

  const sttRes = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form,
  });

  if (!sttRes.ok) {
    const t = await sttRes.text();
    console.error("OpenAI Whisper error:", sttRes.status, t);
    throw new Error(`Transcription failed: ${sttRes.status}`);
  }

  const result: any = await sttRes.json();
  return result.text ?? "";
}

async function transcribeWithDeepgram(signedUrl: string, apiKey: string): Promise<string> {
  // Deepgram fetches the URL itself — no need to stream the file through this function.
  const dgRes = await fetch(
    "https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true&punctuate=true",
    {
      method: "POST",
      headers: {
        Authorization: `Token ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url: signedUrl }),
    }
  );

  if (!dgRes.ok) {
    const t = await dgRes.text();
    console.error("Deepgram error:", dgRes.status, t);
    throw new Error(`Transcription failed (Deepgram): ${dgRes.status}`);
  }

  const result: any = await dgRes.json();
  const channels = result?.results?.channels ?? [];
  const parts: string[] = [];
  for (const ch of channels) {
    const alt = ch?.alternatives?.[0];
    if (alt?.transcript) parts.push(alt.transcript);
  }
  return parts.join(" ").trim();
}
