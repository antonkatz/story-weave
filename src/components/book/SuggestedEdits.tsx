import { useEffect, useState } from "react";
import { Check, X, ChevronDown, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { applyEdit as applyEditShared, type EditRow } from "@/lib/edits";

type AgentKind = "structure" | "quotation" | "writing" | "splitter";

type Edit = {
  id: string;
  book_id: string;
  chapter_id: string | null;
  agent: AgentKind | null;
  action_type: string | null;
  payload: Record<string, unknown> | null;
  // legacy fields
  kind: "append" | "replace" | "new_chapter" | null;
  summary: string;
  proposed_title: string | null;
  proposed_content: string | null;
  status: "pending" | "approved" | "rejected";
  created_at: string;
};

const AGENT_LABELS: Record<AgentKind, string> = {
  structure: "Structure",
  quotation: "Quotation",
  writing: "Writing",
  splitter: "Splitter",
};

const ACTION_LABELS: Record<string, string> = {
  add_chapter: "Add chapter",
  rename_chapter: "Rename chapter",
  set_chapter_theme: "Set chapter theme",
  combine_chapters: "Combine chapters",
  add_section: "Add section",
  rename_section: "Rename section",
  set_section_purpose: "Set section purpose",
  remove_section: "Remove section",
  create_quote: "Create quote",
  assign_quote: "Assign quote",
  write_section: "Write section",
  append_to_section: "Append to section",
  replace_section: "Replace section",
  split_message: "Split message",
};

const ACTION_ORDER: Record<string, number> = {
  add_chapter: 0,
  add_section: 1,
};

export type EditTarget = { chapterId: string; sectionId: string | null };

export function SuggestedEdits({
  bookId,
  onApplied,
}: {
  bookId: string;
  onApplied?: (target: EditTarget) => void;
}) {
  const { user } = useAuth();
  const [edits, setEdits] = useState<Edit[]>([]);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    let active = true;
    supabase
      .from("suggested_edits")
      .select("*")
      .eq("book_id", bookId)
      .order("created_at", { ascending: false })
      .limit(100)
      .then(({ data }) => {
        if (active) setEdits((data ?? []) as Edit[]);
      });
    return () => {
      active = false;
    };
  }, [bookId]);

  useEffect(() => {
    const channel = supabase
      .channel(`edits:${bookId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "suggested_edits", filter: `book_id=eq.${bookId}` },
        (payload) => {
          if (payload.eventType === "INSERT") {
            setEdits((prev) => [payload.new as Edit, ...prev]);
          } else if (payload.eventType === "UPDATE") {
            setEdits((prev) =>
              prev.map((e) => (e.id === (payload.new as Edit).id ? (payload.new as Edit) : e)),
            );
          } else if (payload.eventType === "DELETE") {
            setEdits((prev) => prev.filter((e) => e.id !== (payload.old as Edit).id));
          }
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [bookId]);

  const reject = async (edit: Edit) => {
    if (!user) return;
    await supabase
      .from("suggested_edits")
      .update({ status: "rejected", resolved_at: new Date().toISOString(), resolved_by: user.id })
      .eq("id", edit.id);
  };

  const approve = async (edit: Edit) => {
    if (!user) return;
    try {
      const target = await applyEditShared(supabase, edit as EditRow, bookId);
      await supabase
        .from("suggested_edits")
        .update({ status: "approved", resolved_at: new Date().toISOString(), resolved_by: user.id })
        .eq("id", edit.id);
      const id = toast.success("Applied", {
        onDismiss: () => toast.dismiss(id),
      });
      // Make a click anywhere on the toast dismiss it
      setTimeout(() => {
        const el = document.querySelector(`[data-sonner-toast][data-id="${id}"]`);
        el?.addEventListener("click", () => toast.dismiss(id), { once: true });
      }, 0);
      if (target && onApplied) onApplied(target);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not apply");
    }
  };

  const pending = edits.filter((e) => e.status === "pending");

  // Group pending by agent
  const byAgent: Record<string, Edit[]> = { structure: [], quotation: [], writing: [], splitter: [], legacy: [] };
  for (const e of pending) {
    const key = e.agent ?? "legacy";
    (byAgent[key] ??= []).push(e);
  }

  // Sort: chapters first, then sections, then everything else
  const sortActions = (list: Edit[]) =>
    [...list].sort((a, b) => {
      const ao = ACTION_ORDER[a.action_type ?? ""] ?? 99;
      const bo = ACTION_ORDER[b.action_type ?? ""] ?? 99;
      if (ao !== bo) return ao - bo;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });

  if (pending.length === 0) {
    return (
      <div className="border-t border-border bg-paper/40 px-4 py-3 text-xs italic text-muted-foreground">
        No pending suggestions. Run the agents to generate some.
      </div>
    );
  }

  return (
    <div className="border-t border-border bg-paper/40">
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="flex w-full items-center justify-between px-4 py-2 text-left text-sm font-medium hover:bg-secondary/40"
      >
        <span className="flex items-center gap-2">
          {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          Suggested edits ({pending.length})
        </span>
      </button>
      {!collapsed && (
        <div className="max-h-[40vh] space-y-3 overflow-y-auto px-3 pb-3">
          {(["structure", "splitter", "quotation", "writing", "legacy"] as const).map((agent) => {
            const list = sortActions(byAgent[agent] ?? []);
            if (list.length === 0) return null;
            return (
              <div key={agent}>
                <h5 className="mb-1 px-1 text-xs uppercase tracking-wide text-muted-foreground">
                  {agent === "legacy" ? "General" : AGENT_LABELS[agent as AgentKind]} ({list.length})
                </h5>
                <div className="space-y-2">
                  {list.map((e) => (
                    <EditCard key={e.id} edit={e} pending={pending} onApprove={() => approve(e)} onReject={() => reject(e)} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function EditCard({
  edit,
  pending,
  onApprove,
  onReject,
}: {
  edit: Edit;
  pending: Edit[];
  onApprove: () => void;
  onReject: () => void;
}) {
  const actionLabel = edit.action_type ? ACTION_LABELS[edit.action_type] ?? edit.action_type : edit.kind;
  const preview =
    edit.proposed_content ||
    (edit.payload && typeof edit.payload === "object"
      ? extractPreview(edit.payload as Record<string, unknown>)
      : "");

  // For add_section: show which chapter it will land in (existing or pending)
  let chapterHint: string | null = null;
  if (edit.action_type === "add_section") {
    const p = (edit.payload ?? {}) as Record<string, any>;
    if (!edit.chapter_id && p.chapter_title_hint) {
      chapterHint = `Will create chapter: "${p.chapter_title_hint}"`;
    }
  }

  return (
    <div className="rounded-lg border border-border bg-paper p-2.5 text-sm shadow-sm">
      <div className="flex items-center gap-2">
        <span className="rounded bg-plum/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-plum">
          {actionLabel}
        </span>
        {chapterHint && (
          <span className="rounded bg-sage/15 px-1.5 py-0.5 text-[10px] font-medium text-sage-foreground">
            {chapterHint}
          </span>
        )}
      </div>
      <p className="mt-1.5 text-sm">{edit.summary}</p>
      {preview && (
        <div className="mt-1.5 max-h-28 overflow-y-auto rounded border border-border bg-background/60 p-2 font-serif text-xs leading-relaxed">
          {preview}
        </div>
      )}
      <div className="mt-2 flex justify-end gap-1.5">
        <Button size="sm" variant="outline" onClick={onReject}>
          <X className="mr-1 h-3.5 w-3.5" /> Reject
        </Button>
        <Button size="sm" onClick={onApprove} className="bg-sage text-sage-foreground hover:bg-sage/90">
          <Check className="mr-1 h-3.5 w-3.5" /> Approve
        </Button>
      </div>
    </div>
  );
}

function extractPreview(payload: Record<string, unknown>): string {
  for (const key of ["content", "text", "synopsis", "theme", "purpose", "title"]) {
    const v = payload[key];
    if (typeof v === "string" && v.trim()) return v;
  }
  return "";
}

// ============================================================
// Action appliers
// ============================================================
async function applyEdit(edit: Edit, bookId: string): Promise<EditTarget | null> {
  if (edit.action_type) {
    return applyAgentAction(edit, bookId);
  }
  return applyLegacyEdit(edit, bookId);
}

async function lookupSectionChapter(sectionId: string): Promise<string | null> {
  const { data } = await supabase.from("chapter_sections").select("chapter_id").eq("id", sectionId).maybeSingle();
  return data?.chapter_id ?? null;
}

async function applyAgentAction(edit: Edit, bookId: string): Promise<EditTarget | null> {
  const p = (edit.payload ?? {}) as Record<string, any>;
  const t = edit.action_type!;
  switch (t) {
    case "add_chapter": {
      const { data: existing } = await supabase
        .from("chapters")
        .select("position")
        .eq("book_id", bookId)
        .order("position", { ascending: false })
        .limit(1);
      const nextPos = (existing?.[0]?.position ?? -1) + 1;
      const { data: created, error } = await supabase
        .from("chapters")
        .insert({
          book_id: bookId,
          title: p.title || "New chapter",
          position: nextPos,
          synopsis: p.synopsis || "",
          theme: p.theme || "",
        })
        .select("id")
        .single();
      if (error) throw error;
      const srcIds: string[] = Array.isArray(p.source_message_ids) ? p.source_message_ids : [];
      if (created && srcIds.length > 0) {
        await supabase.from("chapter_message_context").insert(
          srcIds.map((mid) => ({ book_id: bookId, chapter_id: created.id, message_id: mid })),
        );
      }
      return { chapterId: created.id, sectionId: null };
    }
    case "rename_chapter": {
      if (!edit.chapter_id) throw new Error("Missing chapter_id");
      const { error } = await supabase.from("chapters").update({ title: p.title }).eq("id", edit.chapter_id);
      if (error) throw error;
      return { chapterId: edit.chapter_id, sectionId: null };
    }
    case "set_chapter_synopsis": {
      if (!edit.chapter_id) throw new Error("Missing chapter_id");
      const { error } = await supabase.from("chapters").update({ synopsis: p.synopsis ?? "" }).eq("id", edit.chapter_id);
      if (error) throw error;
      return { chapterId: edit.chapter_id, sectionId: null };
    }
    case "set_chapter_theme": {
      if (!edit.chapter_id) throw new Error("Missing chapter_id");
      const { error } = await supabase.from("chapters").update({ theme: p.theme ?? "" }).eq("id", edit.chapter_id);
      if (error) throw error;
      return { chapterId: edit.chapter_id, sectionId: null };
    }
    case "combine_chapters": {
      const targetId = edit.chapter_id ?? p.chapter_id;
      const otherId = p.other_chapter_id;
      if (!targetId || !otherId) throw new Error("Missing chapter ids");
      const { error: secErr } = await supabase
        .from("chapter_sections")
        .update({ chapter_id: targetId })
        .eq("chapter_id", otherId);
      if (secErr) throw secErr;
      const { error: plErr } = await supabase
        .from("quote_placements")
        .update({ chapter_id: targetId })
        .eq("chapter_id", otherId);
      if (plErr) throw plErr;
      const { error: delErr } = await supabase.from("chapters").delete().eq("id", otherId);
      if (delErr) throw delErr;
      return { chapterId: targetId, sectionId: null };
    }
    case "add_section": {
      let chapterId = edit.chapter_id ?? p.chapter_id;
      const titleHint: string | undefined = p.chapter_title_hint;

      // If we have a chapter title hint, prefer matching an existing chapter (case-insensitive)
      // before creating a new one — prevents two suggestions from creating duplicate chapters.
      if (!chapterId && titleHint) {
        const { data: matchChapters } = await supabase
          .from("chapters")
          .select("id,title")
          .eq("book_id", bookId);
        const norm = (s: string) => s.trim().toLowerCase();
        const existing = (matchChapters ?? []).find((c) => norm(c.title) === norm(titleHint));
        if (existing) chapterId = existing.id;
      }

      if (!chapterId) {
        if (!titleHint) {
          // Fallback: create a chapter using the section title so we never block the user.
          const fallbackTitle = (p.title as string)?.trim() || "New chapter";
          const { data: chExisting0 } = await supabase
            .from("chapters")
            .select("position")
            .eq("book_id", bookId)
            .order("position", { ascending: false })
            .limit(1);
          const chPos0 = (chExisting0?.[0]?.position ?? -1) + 1;
          const { data: newChapter0, error: chErr0 } = await supabase
            .from("chapters")
            .insert({
              book_id: bookId,
              title: fallbackTitle,
              position: chPos0,
              synopsis: p.purpose || "",
              theme: "",
            })
            .select("id")
            .single();
          if (chErr0) throw chErr0;
          chapterId = newChapter0.id;
        } else {
          const { data: chExisting } = await supabase
            .from("chapters")
            .select("position")
            .eq("book_id", bookId)
            .order("position", { ascending: false })
            .limit(1);
          const chPos = (chExisting?.[0]?.position ?? -1) + 1;
          const { data: newChapter, error: chErr } = await supabase
            .from("chapters")
            .insert({
              book_id: bookId,
              title: titleHint,
              position: chPos,
              synopsis: p.chapter_synopsis_hint || "",
              theme: p.chapter_theme_hint || "",
            })
            .select("id")
            .single();
          if (chErr) throw chErr;
          chapterId = newChapter.id;
        }
      }
      const { data: existing } = await supabase
        .from("chapter_sections")
        .select("position")
        .eq("chapter_id", chapterId)
        .order("position", { ascending: false })
        .limit(1);
      const nextPos = (existing?.[0]?.position ?? -1) + 1;
      const sectionTitle =
        (p.title as string)?.trim() ||
        (edit.summary as string)?.trim() ||
        (p.summary as string)?.trim() ||
        "Untitled section";
      const sectionPurpose = (p.purpose as string)?.trim() || (p.synopsis as string)?.trim() || "";
      const { data: created, error } = await supabase
        .from("chapter_sections")
        .insert({
          book_id: bookId,
          chapter_id: chapterId,
          title: sectionTitle,
          purpose: sectionPurpose,
          position: nextPos,
        })
        .select("id")
        .single();
      if (error) throw error;
      return { chapterId, sectionId: created.id };
    }
    case "rename_section": {
      if (!p.section_id) throw new Error("Missing section_id");
      const chapterId = await lookupSectionChapter(p.section_id);
      const { error } = await supabase.from("chapter_sections").update({ title: p.title }).eq("id", p.section_id);
      if (error) throw error;
      return chapterId ? { chapterId, sectionId: p.section_id } : null;
    }
    case "set_section_purpose": {
      if (!p.section_id) throw new Error("Missing section_id");
      const chapterId = await lookupSectionChapter(p.section_id);
      const { error } = await supabase.from("chapter_sections").update({ purpose: p.purpose ?? "" }).eq("id", p.section_id);
      if (error) throw error;
      return chapterId ? { chapterId, sectionId: p.section_id } : null;
    }
    case "remove_section": {
      if (!p.section_id) throw new Error("Missing section_id");
      const chapterId = await lookupSectionChapter(p.section_id);
      const { error } = await supabase.from("chapter_sections").delete().eq("id", p.section_id);
      if (error) throw error;
      return chapterId ? { chapterId, sectionId: null } : null;
    }
    case "create_quote": {
      const text = typeof p.text === "string" ? p.text.trim() : "";
      if (!text) throw new Error("Agent did not provide quote text — reject this and re-run.");
      if (!p.chapter_id) throw new Error("This quote isn't assigned to a chapter — reject and re-run the agent.");
      const { data: created, error } = await supabase
        .from("quotes")
        .insert({
          book_id: bookId,
          text,
          source_message_id: p.source_message_id ?? null,
          speaker_id: p.speaker_id ?? null,
        })
        .select("id")
        .single();
      if (error) throw error;
      const { error: plErr } = await supabase.from("quote_placements").insert({
        book_id: bookId,
        quote_id: created.id,
        chapter_id: p.chapter_id,
        section_id: p.section_id ?? null,
      });
      if (plErr) throw plErr;
      return { chapterId: p.chapter_id, sectionId: p.section_id ?? null };
    }
    case "assign_quote": {
      const quote_id = p.quote_id;
      if (!quote_id) throw new Error("Approve the create_quote first, then re-run the agent so this can reference its id.");
      if (!p.chapter_id) throw new Error("Missing chapter_id");
      const { error } = await supabase.from("quote_placements").insert({
        book_id: bookId,
        quote_id,
        chapter_id: p.chapter_id,
        section_id: p.section_id ?? null,
      });
      if (error) throw error;
      return { chapterId: p.chapter_id, sectionId: p.section_id ?? null };
    }
    case "write_section":
    case "replace_section": {
      if (!p.section_id) throw new Error("Missing section_id");
      const chapterId = await lookupSectionChapter(p.section_id);
      const { error } = await supabase.from("chapter_sections").update({ content: p.content ?? "" }).eq("id", p.section_id);
      if (error) throw error;
      return chapterId ? { chapterId, sectionId: p.section_id } : null;
    }
    case "append_to_section": {
      if (!p.section_id) throw new Error("Missing section_id");
      const chapterId = await lookupSectionChapter(p.section_id);
      const { data: sec } = await supabase.from("chapter_sections").select("content").eq("id", p.section_id).single();
      const next = [sec?.content ?? "", p.content ?? ""].filter(Boolean).join("\n\n");
      const { error } = await supabase.from("chapter_sections").update({ content: next }).eq("id", p.section_id);
      if (error) throw error;
      return chapterId ? { chapterId, sectionId: p.section_id } : null;
    }
    case "split_message": {
      const srcId = p.source_message_id;
      const parts = Array.isArray(p.parts) ? p.parts : [];
      if (!srcId) throw new Error("Missing source_message_id");
      if (parts.length < 2) throw new Error("Need at least 2 parts to split");
      const { data: srcMsg, error: srcErr } = await supabase
        .from("messages")
        .select("id,book_id,author_id,kind,created_at")
        .eq("id", srcId)
        .single();
      if (srcErr || !srcMsg) throw new Error("Source message not found");
      const baseTime = new Date(srcMsg.created_at).getTime();
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
      }).filter((r) => r.body);
      if (newRows.length === 0) throw new Error("All parts were empty");
      const { error: insErr } = await supabase.from("messages").insert(newRows);
      if (insErr) throw insErr;
      const { error: delErr } = await supabase.from("messages").delete().eq("id", srcId);
      if (delErr) throw delErr;
      return null;
    }
    default:
      throw new Error(`Unknown action_type: ${t}`);
  }
}

async function applyLegacyEdit(_edit: Edit, _bookId: string): Promise<EditTarget | null> {
  throw new Error(
    "This is a legacy chapter-content edit. Free-form chapter prose has been removed — please reject and re-run the agents.",
  );
}
