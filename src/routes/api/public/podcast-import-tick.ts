// Background worker for podcast imports. Called every 30s by pg_cron.
// Picks one queued episode, downloads audio, kicks off transcription.
// When all episodes for an import are done, runs Structure then Quote
// agents and auto-approves every emitted suggestion.
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { streamAudioToStorage } from "@/lib/podcast.server";
import { applyEdit, type EditRow } from "@/lib/edits";

const SUPABASE_URL = process.env.SUPABASE_URL!;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;

async function callEdgeFn(name: string, body: Record<string, unknown>) {
  const r = await fetch(`${SUPABASE_URL}/functions/v1/${name}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${SERVICE_KEY}`,
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`${name} failed: ${r.status} ${await r.text()}`);
  return r.json();
}

async function processEpisode(epId: string): Promise<void> {
  const { data: ep } = await supabaseAdmin
    .from("podcast_import_episodes")
    .select("*, podcast_imports!inner(book_id, user_id)")
    .eq("id", epId)
    .single();
  if (!ep) return;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const imp = (ep as any).podcast_imports as { book_id: string; user_id: string };
  const bookId = imp.book_id;
  const storagePath = `${bookId}/${epId}.mp3`;

  await supabaseAdmin.from("podcast_import_episodes")
    .update({ status: "downloading", attempts: (ep.attempts ?? 0) + 1, locked_at: new Date().toISOString() })
    .eq("id", epId);

  await streamAudioToStorage(supabaseAdmin, ep.audio_url, storagePath);

  const { data: msg, error: msgErr } = await supabaseAdmin
    .from("messages")
    .insert({
      book_id: bookId,
      author_id: imp.user_id,
      kind: "voice",
      body: ep.episode_title,
      audio_path: storagePath,
    })
    .select("id")
    .single();
  if (msgErr || !msg) throw msgErr ?? new Error("Could not create message");

  await supabaseAdmin.from("podcast_import_episodes")
    .update({ status: "transcribing", source_message_id: msg.id })
    .eq("id", epId);

  await callEdgeFn("transcribe-voice", { messageId: msg.id, audioPath: storagePath });

  await supabaseAdmin.from("podcast_import_episodes")
    .update({ status: "done" })
    .eq("id", epId);
}

async function maybeRunAgents(importId: string): Promise<void> {
  const { data: imp } = await supabaseAdmin
    .from("podcast_imports")
    .select("id, book_id, status, agents_started_at")
    .eq("id", importId)
    .single();
  if (!imp || !imp.book_id || imp.status === "done" || imp.agents_started_at) return;

  const { data: eps } = await supabaseAdmin
    .from("podcast_import_episodes")
    .select("status")
    .eq("import_id", importId);
  const all = eps ?? [];
  if (all.length === 0 || !all.every((e) => e.status === "done")) return;

  await supabaseAdmin.from("podcast_imports")
    .update({ status: "running", agents_started_at: new Date().toISOString() })
    .eq("id", importId);

  // Structure agent → auto-approve all
  await callEdgeFn("run-agents", { bookId: imp.book_id, agent: "structure" });
  await autoApprovePending(imp.book_id);

  // Quote agent → auto-approve all
  await callEdgeFn("run-agents", { bookId: imp.book_id, agent: "quotation" });
  await autoApprovePending(imp.book_id);

  await supabaseAdmin.from("podcast_imports")
    .update({ status: "done" })
    .eq("id", importId);
}

async function autoApprovePending(bookId: string): Promise<void> {
  const { data: edits } = await supabaseAdmin
    .from("suggested_edits")
    .select("*")
    .eq("book_id", bookId)
    .eq("status", "pending")
    .order("created_at", { ascending: true });
  for (const e of (edits ?? []) as EditRow[]) {
    try {
      await applyEdit(supabaseAdmin, e, bookId);
      await supabaseAdmin.from("suggested_edits")
        .update({ status: "approved", resolved_at: new Date().toISOString() })
        .eq("id", e.id);
    } catch (err) {
      await supabaseAdmin.from("suggested_edits")
        .update({ status: "rejected", resolved_at: new Date().toISOString() })
        .eq("id", e.id);
      console.error("auto-approve failed for", e.id, err);
    }
  }
}

export const Route = createFileRoute("/api/public/podcast-import-tick")({
  server: {
    handlers: {
      POST: async () => {
        // Pick one queued episode
        const { data: queued } = await supabaseAdmin
          .from("podcast_import_episodes")
          .select("id, import_id")
          .eq("status", "queued")
          .order("created_at", { ascending: true })
          .limit(1);
        const ep = queued?.[0];

        if (ep) {
          try {
            await processEpisode(ep.id);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            await supabaseAdmin.from("podcast_import_episodes")
              .update({ status: "error", error: msg }).eq("id", ep.id);
            await supabaseAdmin.from("podcast_imports")
              .update({ status: "error", error: msg }).eq("id", ep.import_id);
          }
        }

        // Check every running import for agent kickoff
        const { data: pending } = await supabaseAdmin
          .from("podcast_imports")
          .select("id")
          .in("status", ["pending", "running"]);
        for (const p of pending ?? []) {
          try {
            await maybeRunAgents(p.id);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            await supabaseAdmin.from("podcast_imports")
              .update({ status: "error", error: msg }).eq("id", p.id);
          }
        }

        return Response.json({ ok: true, processed: ep?.id ?? null });
      },
    },
  },
});
