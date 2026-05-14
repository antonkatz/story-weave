// Shared applier for suggested_edits actions. Accepts any Supabase client
// (browser publishable client OR server admin client) so the same logic can
// be invoked from the UI (RLS-respecting) and from background workers.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SbClient = any;

export type EditTarget = { chapterId: string; sectionId: string | null };

export type EditRow = {
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

export async function applyEdit(
  client: SbClient,
  edit: EditRow,
  bookId: string,
): Promise<EditTarget | null> {
  if (edit.action_type) return applyAgentAction(client, edit, bookId);
  throw new Error(
    "This is a legacy chapter-content edit. Free-form chapter prose has been removed — please reject and re-run the agents.",
  );
}

async function lookupSectionChapter(client: SbClient, sectionId: string): Promise<string | null> {
  const { data } = await client
    .from("chapter_sections")
    .select("chapter_id")
    .eq("id", sectionId)
    .maybeSingle();
  return data?.chapter_id ?? null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function applyAgentAction(client: SbClient, edit: EditRow, bookId: string): Promise<EditTarget | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const p = (edit.payload ?? {}) as Record<string, any>;
  const t = edit.action_type!;
  switch (t) {
    case "add_chapter": {
      const { data: existing } = await client
        .from("chapters").select("position").eq("book_id", bookId)
        .order("position", { ascending: false }).limit(1);
      const nextPos = (existing?.[0]?.position ?? -1) + 1;
      const { data: created, error } = await client
        .from("chapters").insert({
          book_id: bookId,
          title: p.title || "New chapter",
          position: nextPos,
          synopsis: p.synopsis || "",
          theme: p.theme || "",
        }).select("id").single();
      if (error) throw error;
      const srcIds: string[] = Array.isArray(p.source_message_ids) ? p.source_message_ids : [];
      if (created && srcIds.length > 0) {
        await client.from("chapter_message_context").insert(
          srcIds.map((mid) => ({ book_id: bookId, chapter_id: created.id, message_id: mid })),
        );
      }
      return { chapterId: created.id, sectionId: null };
    }
    case "rename_chapter": {
      if (!edit.chapter_id) throw new Error("Missing chapter_id");
      const { error } = await client.from("chapters").update({ title: p.title }).eq("id", edit.chapter_id);
      if (error) throw error;
      return { chapterId: edit.chapter_id, sectionId: null };
    }
    case "set_chapter_synopsis": {
      if (!edit.chapter_id) throw new Error("Missing chapter_id");
      const { error } = await client.from("chapters").update({ synopsis: p.synopsis ?? "" }).eq("id", edit.chapter_id);
      if (error) throw error;
      return { chapterId: edit.chapter_id, sectionId: null };
    }
    case "set_chapter_theme": {
      if (!edit.chapter_id) throw new Error("Missing chapter_id");
      const { error } = await client.from("chapters").update({ theme: p.theme ?? "" }).eq("id", edit.chapter_id);
      if (error) throw error;
      return { chapterId: edit.chapter_id, sectionId: null };
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
      return { chapterId: targetId, sectionId: null };
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
        const { data: chExisting } = await client
          .from("chapters").select("position").eq("book_id", bookId)
          .order("position", { ascending: false }).limit(1);
        const chPos = (chExisting?.[0]?.position ?? -1) + 1;
        const { data: newChapter, error: chErr } = await client
          .from("chapters").insert({
            book_id: bookId,
            title: fallbackTitle,
            position: chPos,
            synopsis: p.chapter_synopsis_hint || p.purpose || "",
            theme: p.chapter_theme_hint || "",
          }).select("id").single();
        if (chErr) throw chErr;
        chapterId = newChapter.id;
      }
      const { data: existing } = await client
        .from("chapter_sections").select("position").eq("chapter_id", chapterId)
        .order("position", { ascending: false }).limit(1);
      const nextPos = (existing?.[0]?.position ?? -1) + 1;
      const sectionTitle =
        (p.title as string)?.trim() || (edit.summary as string)?.trim() ||
        (p.summary as string)?.trim() || "Untitled section";
      const sectionPurpose = (p.purpose as string)?.trim() || (p.synopsis as string)?.trim() || "";
      const { data: created, error } = await client
        .from("chapter_sections").insert({
          book_id: bookId, chapter_id: chapterId,
          title: sectionTitle, purpose: sectionPurpose, position: nextPos,
        }).select("id").single();
      if (error) throw error;
      return { chapterId, sectionId: created.id };
    }
    case "rename_section": {
      if (!p.section_id) throw new Error("Missing section_id");
      const chapterId = await lookupSectionChapter(client, p.section_id);
      const { error } = await client.from("chapter_sections").update({ title: p.title }).eq("id", p.section_id);
      if (error) throw error;
      return chapterId ? { chapterId, sectionId: p.section_id } : null;
    }
    case "set_section_purpose": {
      if (!p.section_id) throw new Error("Missing section_id");
      const chapterId = await lookupSectionChapter(client, p.section_id);
      const { error } = await client.from("chapter_sections").update({ purpose: p.purpose ?? "" }).eq("id", p.section_id);
      if (error) throw error;
      return chapterId ? { chapterId, sectionId: p.section_id } : null;
    }
    case "remove_section": {
      if (!p.section_id) throw new Error("Missing section_id");
      const chapterId = await lookupSectionChapter(client, p.section_id);
      const { error } = await client.from("chapter_sections").delete().eq("id", p.section_id);
      if (error) throw error;
      return chapterId ? { chapterId, sectionId: null } : null;
    }
    case "create_quote": {
      const text = typeof p.text === "string" ? p.text.trim() : "";
      if (!text) throw new Error("Agent did not provide quote text — reject this and re-run.");
      if (!p.chapter_id) throw new Error("This quote isn't assigned to a chapter — reject and re-run the agent.");
      const { data: created, error } = await client
        .from("quotes").insert({
          book_id: bookId, text,
          source_message_id: p.source_message_id ?? null,
          speaker_id: p.speaker_id ?? null,
        }).select("id").single();
      if (error) throw error;
      const { error: plErr } = await client.from("quote_placements").insert({
        book_id: bookId, quote_id: created.id, chapter_id: p.chapter_id, section_id: p.section_id ?? null,
      });
      if (plErr) throw plErr;
      return { chapterId: p.chapter_id, sectionId: p.section_id ?? null };
    }
    case "assign_quote": {
      const quote_id = p.quote_id;
      if (!quote_id) throw new Error("Approve the create_quote first, then re-run the agent so this can reference its id.");
      if (!p.chapter_id) throw new Error("Missing chapter_id");
      const { error } = await client.from("quote_placements").insert({
        book_id: bookId, quote_id, chapter_id: p.chapter_id, section_id: p.section_id ?? null,
      });
      if (error) throw error;
      return { chapterId: p.chapter_id, sectionId: p.section_id ?? null };
    }
    case "write_section":
    case "replace_section": {
      if (!p.section_id) throw new Error("Missing section_id");
      const chapterId = await lookupSectionChapter(client, p.section_id);
      const { error } = await client.from("chapter_sections").update({ content: p.content ?? "" }).eq("id", p.section_id);
      if (error) throw error;
      return chapterId ? { chapterId, sectionId: p.section_id } : null;
    }
    case "append_to_section": {
      if (!p.section_id) throw new Error("Missing section_id");
      const chapterId = await lookupSectionChapter(client, p.section_id);
      const { data: sec } = await client.from("chapter_sections").select("content").eq("id", p.section_id).single();
      const next = [sec?.content ?? "", p.content ?? ""].filter(Boolean).join("\n\n");
      const { error } = await client.from("chapter_sections").update({ content: next }).eq("id", p.section_id);
      if (error) throw error;
      return chapterId ? { chapterId, sectionId: p.section_id } : null;
    }
    case "split_message": {
      const srcId = p.source_message_id;
      const parts = Array.isArray(p.parts) ? p.parts : [];
      if (!srcId) throw new Error("Missing source_message_id");
      if (parts.length < 2) throw new Error("Need at least 2 parts to split");
      const { data: srcMsg, error: srcErr } = await client
        .from("messages").select("id,book_id,author_id,kind,created_at").eq("id", srcId).single();
      if (srcErr || !srcMsg) throw new Error("Source message not found");
      const baseTime = new Date(srcMsg.created_at).getTime();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const newRows = parts.map((part: any, idx: number) => {
        const text = (part?.text ?? "").toString().trim();
        const label = (part?.speaker_label ?? "").toString().trim();
        const body = label ? `${label}: ${text}` : text;
        return {
          book_id: bookId,
          author_id: srcMsg.author_id,
          kind: "text" as const,
          body,
          created_at: new Date(baseTime + idx).toISOString(),
        };
      }).filter((r: { body: string }) => r.body);
      if (newRows.length === 0) throw new Error("All parts were empty");
      const { error: insErr } = await client.from("messages").insert(newRows);
      if (insErr) throw insErr;
      const { error: delErr } = await client.from("messages").delete().eq("id", srcId);
      if (delErr) throw delErr;
      return null;
    }
    default:
      throw new Error(`Unknown action_type: ${t}`);
  }
}
