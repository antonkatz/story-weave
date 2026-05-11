// Transcribe an uploaded voice message with Deepgram speaker diarization,
// then split it into one message per speaker turn.
// deno-lint-ignore-file no-explicit-any
import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

type Utterance = {
  start: number;
  end: number;
  transcript: string;
  speaker: number;
};

type Turn = {
  speakerKey: string; // "<sourceMessageId>:<speakerIdx>"
  speakerIdx: number;
  start: number;
  end: number;
  transcript: string;
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const deepgramKey = Deno.env.get("DEEPGRAM_API_KEY");
    if (!deepgramKey) throw new Error("DEEPGRAM_API_KEY is not configured");

    // Use service role for cross-user inserts (turn messages, speaker rows).
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { messageId, audioPath } = await req.json();
    if (!messageId || !audioPath) throw new Error("messageId and audioPath required");

    // Load source message so we know book_id + author_id for the turn rows.
    const { data: sourceMsg, error: msgErr } = await supabase
      .from("messages")
      .select("id,book_id,author_id,created_at")
      .eq("id", messageId)
      .single();
    if (msgErr || !sourceMsg) throw msgErr ?? new Error("Source message not found");

    const { data: signed, error: signErr } = await supabase.storage
      .from("voice-messages")
      .createSignedUrl(audioPath, 60 * 10);
    if (signErr || !signed) throw signErr ?? new Error("Could not sign url");

    console.log(`Transcribing message ${messageId} via Deepgram`);

    const dgRes = await fetch(
      "https://api.deepgram.com/v1/listen?model=nova-2&smart_format=true&punctuate=true&diarize=true&utterances=true",
      {
        method: "POST",
        headers: {
          Authorization: `Token ${deepgramKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ url: signed.signedUrl }),
      },
    );
    if (!dgRes.ok) {
      const t = await dgRes.text();
      console.error("Deepgram error:", dgRes.status, t);
      throw new Error(`Transcription failed (Deepgram): ${dgRes.status}`);
    }
    const dgJson: any = await dgRes.json();
    const utterances: Utterance[] = (dgJson?.results?.utterances ?? []).map(
      (u: any) => ({
        start: Number(u.start) || 0,
        end: Number(u.end) || 0,
        transcript: String(u.transcript ?? "").trim(),
        speaker: Number(u.speaker) || 0,
      }),
    );

    const fullTranscript: string =
      dgJson?.results?.channels?.[0]?.alternatives?.[0]?.transcript ??
      utterances.map((u) => u.transcript).join(" ");

    // Group consecutive same-speaker utterances into turns.
    const turns: Turn[] = [];
    for (const u of utterances) {
      if (!u.transcript) continue;
      const last = turns[turns.length - 1];
      if (last && last.speakerIdx === u.speaker) {
        last.end = u.end;
        last.transcript = `${last.transcript} ${u.transcript}`.trim();
      } else {
        turns.push({
          speakerKey: `${messageId}:${u.speaker}`,
          speakerIdx: u.speaker,
          start: u.start,
          end: u.end,
          transcript: u.transcript,
        });
      }
    }

    // Per-speaker longest single utterance => sample clip.
    const samples = new Map<number, { start: number; end: number; dur: number }>();
    for (const u of utterances) {
      const dur = u.end - u.start;
      const cur = samples.get(u.speaker);
      if (!cur || dur > cur.dur) samples.set(u.speaker, { start: u.start, end: u.end, dur });
    }

    // Update the source/container message with full transcript + diarization payload.
    await supabase
      .from("messages")
      .update({
        transcript: fullTranscript,
        diarization: {
          utterances,
          turns: turns.map((t) => ({
            speakerKey: t.speakerKey,
            speakerIdx: t.speakerIdx,
            start: t.start,
            end: t.end,
            transcript: t.transcript,
          })),
        },
      })
      .eq("id", messageId);

    if (turns.length === 0) {
      return new Response(
        JSON.stringify({ transcript: fullTranscript, turns: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Upsert speaker rows for this book.
    const uniqueSpeakers = Array.from(new Set(turns.map((t) => t.speakerIdx)));

    // How many speakers already exist for this book? Used for default name numbering.
    const { count: existingCount } = await supabase
      .from("book_speakers")
      .select("id", { count: "exact", head: true })
      .eq("book_id", sourceMsg.book_id);

    const speakerKeyToId = new Map<string, string>();
    let nextNum = (existingCount ?? 0) + 1;
    for (const idx of uniqueSpeakers) {
      const key = `${messageId}:${idx}`;
      const sample = samples.get(idx);
      const { data: spk, error: spkErr } = await supabase
        .from("book_speakers")
        .insert({
          book_id: sourceMsg.book_id,
          speaker_key: key,
          display_name: `Speaker ${nextNum++}`,
          sample_message_id: messageId,
          sample_start_sec: sample?.start ?? null,
          sample_end_sec: sample?.end ?? null,
        })
        .select("id")
        .single();
      if (spkErr) {
        console.error("speaker upsert error", spkErr);
        continue;
      }
      speakerKeyToId.set(key, spk!.id);
    }

    // Insert one message per turn. Stagger created_at to preserve order.
    const baseTs = new Date(sourceMsg.created_at).getTime();
    const turnRows = turns.map((t, i) => ({
      book_id: sourceMsg.book_id,
      author_id: sourceMsg.author_id,
      kind: "voice" as const,
      body: "",
      audio_path: audioPath,
      transcript: t.transcript,
      speaker_id: speakerKeyToId.get(t.speakerKey) ?? null,
      source_audio_message_id: messageId,
      audio_start_sec: t.start,
      audio_end_sec: t.end,
      created_at: new Date(baseTs + 1 + i).toISOString(),
    }));

    const { error: insErr } = await supabase.from("messages").insert(turnRows);
    if (insErr) {
      console.error("turn insert error", insErr);
      throw insErr;
    }

    return new Response(
      JSON.stringify({ transcript: fullTranscript, turns: turns.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("transcribe-voice error:", err);
    return new Response(
      JSON.stringify({ error: err instanceof Error ? err.message : String(err) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
