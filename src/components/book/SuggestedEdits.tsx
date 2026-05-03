import { useEffect, useState } from "react";
import { Check, X, ChevronDown, ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";

type AgentKind = "structure" | "quotation" | "writing";

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
};

const ACTION_LABELS: Record<string, string> = {
  add_chapter: "Add chapter",
  rename_chapter: "Rename chapter",
  set_chapter_synopsis: "Set chapter synopsis",
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
};

export function SuggestedEdits({ bookId }: { bookId: string }) {
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
      await applyEdit(edit, bookId);
      await supabase
        .from("suggested_edits")
        .update({ status: "approved", resolved_at: new Date().toISOString(), resolved_by: user.id })
        .eq("id", edit.id);
      toast.success("Applied");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not apply");
    }
  };

  const pending = edits.filter((e) => e.status === "pending");

  // Group pending by agent
  const byAgent: Record<string, Edit[]> = { structure: [], quotation: [], writing: [], legacy: [] };
  for (const e of pending) {
    const key = e.agent ?? "legacy";
    (byAgent[key] ??= []).push(e);
  }

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
          {(["structure", "quotation", "writing", "legacy"] as const).map((agent) => {
            const list = byAgent[agent] ?? [];
            if (list.length === 0) return null;
            return (
              <div key={agent}>
                <h5 className="mb-1 px-1 text-xs uppercase tracking-wide text-muted-foreground">
                  {agent === "legacy" ? "General" : AGENT_LABELS[agent]} ({list.length})
                </h5>
                <div className="space-y-2">
                  {list.map((e) => (
                    <EditCard key={e.id} edit={e} onApprove={() => approve(e)} onReject={() => reject(e)} />
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
  onApprove,
  onReject,
}: {
  edit: Edit;
  onApprove: () => void;
  onReject: () => void;
}) {
  const actionLabel = edit.action_type ? ACTION_LABELS[edit.action_type] ?? edit.action_type : edit.kind;
  const preview =
    edit.proposed_content ||
    (edit.payload && typeof edit.payload === "object"
      ? extractPreview(edit.payload as Record<string, unknown>)
      : "");
  return (
    <div className="rounded-lg border border-border bg-paper p-2.5 text-sm shadow-sm">
      <div className="flex items-center gap-2">
        <span className="rounded bg-plum/15 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-plum">
          {actionLabel}
        </span>
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
async function applyEdit(edit: Edit, bookId: string) {
  if (edit.action_type) {
    return applyAgentAction(edit, bookId);
  }
  // Legacy kind-based
  return applyLegacyEdit(edit, bookId);
}

async function applyAgentAction(edit: Edit, bookId: string) {
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
      const { error } = await supabase.from("chapters").insert({
        book_id: bookId,
        title: p.title || "New chapter",
        position: nextPos,
        synopsis: p.synopsis || "",
        theme: p.theme || "",
      });
      if (error) throw error;
      return;
    }
    case "rename_chapter": {
      if (!edit.chapter_id) throw new Error("Missing chapter_id");
      const { error } = await supabase.from("chapters").update({ title: p.title }).eq("id", edit.chapter_id);
      if (error) throw error;
      return;
    }
    case "set_chapter_synopsis": {
      if (!edit.chapter_id) throw new Error("Missing chapter_id");
      const { error } = await supabase.from("chapters").update({ synopsis: p.synopsis ?? "" }).eq("id", edit.chapter_id);
      if (error) throw error;
      return;
    }
    case "set_chapter_theme": {
      if (!edit.chapter_id) throw new Error("Missing chapter_id");
      const { error } = await supabase.from("chapters").update({ theme: p.theme ?? "" }).eq("id", edit.chapter_id);
      if (error) throw error;
      return;
    }
    case "combine_chapters": {
      const targetId = edit.chapter_id ?? p.chapter_id;
      const otherId = p.other_chapter_id;
      if (!targetId || !otherId) throw new Error("Missing chapter ids");
      // Move sections + placements from other → target, then delete other.
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
      return;
    }
    case "add_section": {
      const chapterId = edit.chapter_id ?? p.chapter_id;
      if (!chapterId) {
        throw new Error(
          "This section was proposed for a not-yet-created chapter. Approve the related add_chapter first, then re-run the agent.",
        );
      }
      const { data: existing } = await supabase
        .from("chapter_sections")
        .select("position")
        .eq("chapter_id", chapterId)
        .order("position", { ascending: false })
        .limit(1);
      const nextPos = (existing?.[0]?.position ?? -1) + 1;
      const { error } = await supabase.from("chapter_sections").insert({
        book_id: bookId,
        chapter_id: chapterId,
        title: p.title || "New section",
        purpose: p.purpose || "",
        position: nextPos,
      });
      if (error) throw error;
      return;
    }
    case "rename_section": {
      if (!p.section_id) throw new Error("Missing section_id");
      const { error } = await supabase.from("chapter_sections").update({ title: p.title }).eq("id", p.section_id);
      if (error) throw error;
      return;
    }
    case "set_section_purpose": {
      if (!p.section_id) throw new Error("Missing section_id");
      const { error } = await supabase.from("chapter_sections").update({ purpose: p.purpose ?? "" }).eq("id", p.section_id);
      if (error) throw error;
      return;
    }
    case "remove_section": {
      if (!p.section_id) throw new Error("Missing section_id");
      const { error } = await supabase.from("chapter_sections").delete().eq("id", p.section_id);
      if (error) throw error;
      return;
    }
    case "create_quote": {
      if (!p.text) throw new Error("Missing quote text");
      const { error } = await supabase.from("quotes").insert({
        book_id: bookId,
        text: p.text,
        source_message_id: p.source_message_id ?? null,
        speaker_id: p.speaker_id ?? null,
      });
      if (error) throw error;
      return;
    }
    case "assign_quote": {
      // Requires concrete quote_id (not quote_ref)
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
      return;
    }
    case "write_section":
    case "replace_section": {
      if (!p.section_id) throw new Error("Missing section_id");
      const { error } = await supabase.from("chapter_sections").update({ content: p.content ?? "" }).eq("id", p.section_id);
      if (error) throw error;
      return;
    }
    case "append_to_section": {
      if (!p.section_id) throw new Error("Missing section_id");
      const { data: sec } = await supabase.from("chapter_sections").select("content").eq("id", p.section_id).single();
      const next = [sec?.content ?? "", p.content ?? ""].filter(Boolean).join("\n\n");
      const { error } = await supabase.from("chapter_sections").update({ content: next }).eq("id", p.section_id);
      if (error) throw error;
      return;
    }
    default:
      throw new Error(`Unknown action_type: ${t}`);
  }
}

async function applyLegacyEdit(edit: Edit, bookId: string) {
  if (edit.kind === "new_chapter") {
    const { data: existing } = await supabase
      .from("chapters")
      .select("position")
      .eq("book_id", bookId)
      .order("position", { ascending: false })
      .limit(1);
    const nextPos = (existing?.[0]?.position ?? -1) + 1;
    const { error } = await supabase.from("chapters").insert({
      book_id: bookId,
      title: edit.proposed_title ?? "New chapter",
      content: edit.proposed_content ?? "",
      position: nextPos,
    });
    if (error) throw error;
  } else if (edit.chapter_id) {
    const { data: chap } = await supabase.from("chapters").select("content").eq("id", edit.chapter_id).single();
    const newContent =
      edit.kind === "append"
        ? [chap?.content ?? "", edit.proposed_content ?? ""].filter(Boolean).join("\n\n")
        : edit.proposed_content ?? "";
    const { error } = await supabase.from("chapters").update({ content: newContent }).eq("id", edit.chapter_id);
    if (error) throw error;
  }
}
