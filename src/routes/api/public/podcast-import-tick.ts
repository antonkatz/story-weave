// Background worker for podcast imports. Invoked every 30s by pg_cron.
// Picks one queued episode, downloads audio, kicks off transcription.
// When all episodes for an import are done, runs Structure then Quote
// agents and auto-approves every emitted suggestion.
import { createFileRoute } from "@tanstack/react-router";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

type SbClient = typeof supabaseAdmin;

async function callEdgeFn(name: string, body: Record<string, unknown>) {
  const SUPABASE_URL = process.env.SUPABASE_URL!;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY!;
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

async function streamAudioToStorage(client: SbClient, audioUrl: string, storagePath: string): Promise<void> {
  const r = await fetch(audioUrl, { headers: { "User-Agent": "Weave/1.0" }, redirect: "follow" });
  if (!r.ok || !r.body) throw new Error(`Audio fetch failed (${r.status})`);
  const MAX = 500 * 1024 * 1024;
  const reader = r.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > MAX) throw new Error("Episode exceeds 500MB cap");
      chunks.push(value);
    }
  }
  const blob = new Blob(chunks as BlobPart[], { type: r.headers.get("content-type") ?? "audio/mpeg" });
  const { error } = await client.storage.from("voice-messages").upload(storagePath, blob, {
    contentType: blob.type,
    upsert: true,
  });
  if (error) throw error;
}

type EditRow = {
  id: string;
  book_id: string;
  chapter_id: string | null;
  agent: string | null;
  action_type: string | null;
  payload: Record<string, unknown> | null;
  kind: "append" | "replace" | "new_chapter" | null;
  summary: string;
  proposed_title: string | null;
  proposed_content: string | null;
  status: "pending" | "approved" | "rejected";
  created_at: string;
};

async function applyEdit(client: SbClient, edit: EditRow, bookId: string): Promise<void> {
  if (!edit.action_type) throw new Error("Legacy chapter-content edit — reject and re-run agents.");
  const p = (edit.payload ?? {}) as Record<string, any>;
  const t = edit.action_type;
  switch (t) {
    case "add_chapter": {
      const { data: existing } = await client.from("chapters").select("position").eq("book_id", bookId).order("position", { ascending: false }).limit(1);
      const nextPos = (existing?.[0]?.position ?? -1) + 1;
      const { data: created, error } = await client.from("chapters").insert({ book_id: bookId, title: p.title || "New chapter", position: nextPos, synopsis: p.synopsis || "", theme: p.theme || "" }).select("id").single();
      if (error) throw error;
      const srcIds: string[] = Array.isArray(p.source_message_ids) ? p.source_message_ids : [];
      if (created && srcIds.length > 0) {
        await client.from("chapter_message_context").insert(srcIds.map((mid: string) => ({ book_id: bookId, chapter_id: created.id, message_id: mid })));
      }
      break;
    }
    case "rename_chapter": {
      if (!edit.chapter_id) throw new Error("Missing chapter_id");
      const { error } = await client.from("chapters").update({ title: p.title }).eq("id", edit.chapter_id);
      if (error) throw error;
      break;
    }
    case "set_chapter_synopsis": {
      if (!edit.chapter_id) throw new Error("Missing chapter_id");
      const { error } = await client.from("chapters").update({ synopsis: p.synopsis ?? "" }).eq("id", edit.chapter_id);
      if (error) throw error;
      break;
    }
    case "set_chapter_theme": {
      if (!edit.chapter_id) throw new Error("Missing chapter_id");
      const { error } = await client.from("chapters").update({ theme: p.theme ?? "" }).eq("id", edit.chapter_id);
      if (error) throw error;
      break;
    }
    case "combine_chapters": {
      const targetId = edit.chapter_id ?? p.chapter_id;
      const otherId = p.other_chapter_id;
      if (!targetId || !otherId) throw new Error("Missing chapter ids");
      const { error: secErr } = await client.from("chapter_sections").update({ chapter_id: targetId }).eq("chapter_id", otherId);
      if (secErr) throw secErr;
      const { error: plErr } = await client.from("quote_placements").update({ chapter_id: targetId }).eq("chapter_id", otherId);
      if (plErr) throw plErr;
      const { error: delErr } = await client.from("chapters").delete().eq("id", otherId);
      if (delErr) throw delErr;
      break;
    }
    case "add_section": {
      let chapterId = edit.chapter_id ?? p.chapter_id;
      const titleHint: string | undefined = p.chapter_title_hint;
      if (!chapterId && titleHint) {
        const { data: matchChapters } = await client.from("chapters").select("id,title").eq("book_id", bookId);
        const norm = (s: string) => s.trim().toLowerCase();
        const existing = (matchChapters ?? []).find((c: { title: string }) => norm(c.title) === norm(titleHint));
        if (existing) chapterId = existing.id;
      }
      if (!chapterId) {
        const fallbackTitle = (titleHint as string) || (p.title as string)?.trim() || "New chapter";
        const { data: chExisting } = await client.from("chapters").select("position").eq("book_id", bookId).order("position", { ascending: false }).limit(1);
        const chPos = (chExisting?.[0]?.position ?? -1) + 1;
        const { data: newChapter, error: chErr } = await client.from("chapters").insert({ book_id: bookId, title: fallbackTitle, position: chPos, synopsis: p.chapter_synopsis_hint || p.purpose || "", theme: p.chapter_theme_hint || "" }).select("id").single();
        if (chErr) throw chErr;
        chapterId = newChapter.id;
      }
      const { data: existing } = await client.from("chapter_sections").select("position").eq("chapter_id", chapterId).order("position", { ascending: false }).limit(1);
      const nextPos = (existing?.[0]?.position ?? -1) + 1;
      const sectionTitle = (p.title as string)?.trim() || (edit.summary as string)?.trim() || (p.summary as string)?.trim() || "Untitled section";
      const sectionPurpose = (p.purpose as string)?.trim() || (p.synopsis as string)?.trim() || "";
      const { error } = await client.from("chapter_sections").insert({ book_id: bookId, chapter_id: chapterId, title: sectionTitle, purpose: sectionPurpose, position: nextPos }).select("id").single();
      if (error) throw error;
      break;
    }
    case "rename_section": {
      if (!p.section_id) throw new Error("Missing section_id");
      const { error } = await client.from("chapter_sections").update({ title: p.title }).eq("id", p.section_id);
      if (error) throw error;
      break;
    }
    case "set_section_purpose": {
      if (!p.section_id) throw new Error("Missing section_id");
      const { error } = await client.from("chapter_sections").update({ purpose: p.purpose ?? "" }).eq("id", p.section_id);
      if (error) throw error;
      break;
    }
    case "remove_section": {
      if (!p.section_id) throw new Error("Missing section_id");
      const { error } = await client.from("chapter_sections").delete().eq("id", p.section_id);
      if (error) throw error;
      break;
    }
    case "create_quote": {
      const text = typeof p.text === "string" ? p.text.trim() : "";
      if (!text) throw new Error("Agent did not provide quote text — reject this and re-run.");
      if (!p.chapter_id) throw new Error("Quote not assigned to a chapter — reject and re-run the agent.");
      const { data: created, error } = await client.from("quotes").insert({ book_id: bookId, text, source_message_id: p.source_message_id ?? null, speaker_id: p.speaker_id ?? null }).select("id").single();
      if (error) throw error;
      const { error: plErr } = await client.from("quote_placements").insert({ book_id: bookId, quote_id: created.id, chapter_id: p.chapter_id, section_id: p.section_id ?? null });
      if (plErr) throw plErr;
      break;
    }
    case "assign_quote": {
      if (!p.quote_id) throw new Error("Missing quote_id");
      if (!p.chapter_id) throw new Error("Missing chapter_id");
      const { error } = await client.from("quote_placements").insert({ book_id: bookId, quote_id: p.quote_id, chapter_id: p.chapter_id, section_id: p.section_id ?? null });
      if (error) throw error;
      break;
    }
    case "write_section":
    case "replace_section": {
      if (!p.section_id) throw new Error("Missing section_id");
      const { error } = await client.from("chapter_sections").update({ content: p.content ?? "" }).eq("id", p.section_id);
      if (error) throw error;
      break;
    }
    case "append_to_section": {
      if (!p.section_id) throw new Error("Missing section_id");
      const { data: sec } = await client.from("chapter_sections").select("content").eq("id", p.section_id).single();
      const next = [sec?.content ?? "", p.content ?? ""].filter(Boolean).join("\n\n");
      const { error } = await client.from("chapter_sections").update({ content: next }).eq("id", p.section_id);
      if (error) throw error;
      break;
    }
    case "split_message": {
      const srcId = p.source_message_id;
      const parts = Array.isArray(p.parts) ? p.parts : [];
      if (!srcId) throw new Error("Missing source_message_id");
      if (parts.length < 2) throw new Error("Need at least 2 parts to split");
      const { data: srcMsg, error: srcErr } = await client.from("messages").select("id,book_id,author_id,kind,created_at").eq("id", srcId).single();
      if (srcErr || !srcMsg) throw new Error("Source message not found");
      const baseTime = new Date(srcMsg.created_at).getTime();
      const newRows = parts.map((part: any, idx: number) => {
        const text = (part?.text ?? "").toString().trim();
        const label = (part?.speaker_label ?? "").toString().trim();
        const body = label ? `${label}: ${text}` : text;
        return { book_id: bookId, author_id: srcMsg.author_id, kind: "text" as const, body, created_at: new Date(baseTime + idx).toISOString() };
      }).filter((r: { body: string }) => r.body);
      if (newRows.length === 0) throw new Error("All parts were empty");
      const { error: insErr } = await client.from("messages").insert(newRows);
      if (insErr) throw insErr;
      const { error: delErr } = await client.from("messages").delete().eq("id", srcId);
      if (delErr) throw delErr;
      break;
    }
    default:
      throw new Error(`Unknown action_type: ${t}`);
  }
}

async function autoApprovePending(bookId: string): Promise<void> {
  const { data: edits } = await supabaseAdmin.from("suggested_edits").select("*").eq("book_id", bookId).eq("status", "pending").order("created_at", { ascending: true });
  for (const e of (edits ?? []) as EditRow[]) {
    try {
      await applyEdit(supabaseAdmin, e, bookId);
      await supabaseAdmin.from("suggested_edits").update({ status: "approved", resolved_at: new Date().toISOString() }).eq("id", e.id);
    } catch (err) {
      await supabaseAdmin.from("suggested_edits").update({ status: "rejected", resolved_at: new Date().toISOString() }).eq("id", e.id);
      console.error("auto-approve failed for", e.id, err);
    }
  }
}

async function processEpisode(epId: string): Promise<void> {
  const { data: ep } = await supabaseAdmin.from("podcast_import_episodes").select("*, podcast_imports!inner(book_id, user_id)").eq("id", epId).single();
  if (!ep) return;
  const imp = (ep as any).podcast_imports as { book_id: string; user_id: string };
  const bookId = imp.book_id;
  const storagePath = `${bookId}/${epId}.mp3`;

  await supabaseAdmin.from("podcast_import_episodes").update({ status: "downloading", attempts: ((ep as any).attempts ?? 0) + 1, locked_at: new Date().toISOString() }).eq("id", epId);

  await streamAudioToStorage(supabaseAdmin, (ep as any).audio_url, storagePath);

  const { data: msg, error: msgErr } = await supabaseAdmin.from("messages").insert({ book_id: bookId, author_id: imp.user_id, kind: "voice", body: (ep as any).episode_title, audio_path: storagePath }).select("id").single();
  if (msgErr || !msg) throw msgErr ?? new Error("Could not create message");

  await supabaseAdmin.from("podcast_import_episodes").update({ status: "transcribing", source_message_id: msg.id }).eq("id", epId);

  await callEdgeFn("transcribe-voice", { messageId: msg.id, audioPath: storagePath });

  await supabaseAdmin.from("podcast_import_episodes").update({ status: "done" }).eq("id", epId);
}

async function maybeRunAgents(importId: string): Promise<void> {
  const { data: imp } = await supabaseAdmin.from("podcast_imports").select("id, book_id, status, agents_started_at").eq("id", importId).single();
  if (!imp || !imp.book_id || imp.status === "done" || imp.agents_started_at) return;

  const { data: eps } = await supabaseAdmin.from("podcast_import_episodes").select("status").eq("import_id", importId);
  const all = eps ?? [];
  if (all.length === 0 || !all.every((e: { status: string }) => e.status === "done")) return;

  await supabaseAdmin.from("podcast_imports").update({ status: "running", agents_started_at: new Date().toISOString() }).eq("id", importId);

  await callEdgeFn("run-agents", { bookId: imp.book_id, agent: "structure" });
  await autoApprovePending(imp.book_id);

  await callEdgeFn("run-agents", { bookId: imp.book_id, agent: "quotation" });
  await autoApprovePending(imp.book_id);

  await supabaseAdmin.from("podcast_imports").update({ status: "done" }).eq("id", importId);
}

async function tick(): Promise<{ processed: string | null }> {
  const { data: queued } = await supabaseAdmin.from("podcast_import_episodes").select("id, import_id").eq("status", "queued").order("created_at", { ascending: true }).limit(1);
  const ep = queued?.[0];

  if (ep) {
    try {
      await processEpisode(ep.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await supabaseAdmin.from("podcast_import_episodes").update({ status: "error", error: msg }).eq("id", ep.id);
      await supabaseAdmin.from("podcast_imports").update({ status: "error", error: msg }).eq("id", ep.import_id);
    }
  }

  const { data: pending } = await supabaseAdmin.from("podcast_imports").select("id").in("status", ["pending", "running"]);
  for (const p of pending ?? []) {
    try {
      await maybeRunAgents(p.id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await supabaseAdmin.from("podcast_imports").update({ status: "error", error: msg }).eq("id", p.id);
    }
  }

  return { processed: ep?.id ?? null };
}

export const Route = createFileRoute("/api/public/podcast-import-tick")({
  server: {
    handlers: {
      POST: async () => {
        try {
          const result = await tick();
          return Response.json({ ok: true, ...result });
        } catch (err) {
          return Response.json({ ok: false, error: String(err) }, { status: 500 });
        }
      },
      GET: async () => {
        try {
          const result = await tick();
          return Response.json({ ok: true, ...result });
        } catch (err) {
          return Response.json({ ok: false, error: String(err) }, { status: 500 });
        }
      },
    },
  },
});
