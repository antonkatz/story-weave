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

// Apply logic lives in src/lib/edits.ts (shared with the podcast import worker).

