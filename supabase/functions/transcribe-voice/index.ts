// Transcribe an uploaded voice message using ElevenLabs Scribe, then update the message row.
// deno-lint-ignore-file no-explicit-any
import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (!apiKey) throw new Error("OPENAI_API_KEY not configured");

    const authHeader = req.headers.get("Authorization") ?? "";
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_PUBLISHABLE_KEY") ?? Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const { messageId, audioPath } = await req.json();
    if (!messageId || !audioPath) throw new Error("messageId and audioPath required");

    // Download the file via signed URL (RLS scoped to the caller)
    const { data: signed, error: signErr } = await supabase.storage
      .from("voice-messages")
      .createSignedUrl(audioPath, 60);
    if (signErr || !signed) throw signErr ?? new Error("Could not sign url");

    const fileRes = await fetch(signed.signedUrl);
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
    const transcript: string = result.text ?? "";

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
