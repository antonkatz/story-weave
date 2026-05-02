import { useEffect, useState } from "react";
import { Sparkles, Check, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";

type Edit = {
  id: string;
  chapter_id: string | null;
  kind: "append" | "replace" | "new_chapter";
  summary: string;
  proposed_title: string | null;
  proposed_content: string;
  status: "pending" | "approved" | "rejected";
  created_at: string;
};

export function Edits({
  bookId,
  chapters,
}: {
  bookId: string;
  chapters: { id: string; title: string }[];
}) {
  const { user } = useAuth();
  const [edits, setEdits] = useState<Edit[]>([]);
  const [generating, setGenerating] = useState(false);

  const chapterTitle = (id: string | null) =>
    id ? chapters.find((c) => c.id === id)?.title ?? "(removed chapter)" : "New chapter";

  useEffect(() => {
    let active = true;
    supabase
      .from("suggested_edits")
      .select("*")
      .eq("book_id", bookId)
      .order("created_at", { ascending: false })
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
              prev.map((e) => (e.id === (payload.new as Edit).id ? (payload.new as Edit) : e))
            );
          } else if (payload.eventType === "DELETE") {
            setEdits((prev) => prev.filter((e) => e.id !== (payload.old as Edit).id));
          }
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [bookId]);

  const generate = async () => {
    setGenerating(true);
    try {
      const { data, error } = await supabase.functions.invoke("generate-edits", {
        body: { bookId },
      });
      if (error) throw error;
      const inserted = (data as { inserted?: number })?.inserted ?? 0;
      if (inserted === 0) {
        toast.info("Nothing new to suggest yet — keep talking!");
      } else {
        toast.success(`${inserted} new suggested edit${inserted === 1 ? "" : "s"}`);
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not generate edits");
    } finally {
      setGenerating(false);
    }
  };

  const approve = async (edit: Edit) => {
    if (!user) return;
    try {
      if (edit.kind === "new_chapter") {
        const maxPos = Math.max(0, ...chapters.map((_, i) => i)) + 1;
        const { error } = await supabase.from("chapters").insert({
          book_id: bookId,
          title: edit.proposed_title ?? "New chapter",
          content: edit.proposed_content,
          position: maxPos,
        });
        if (error) throw error;
      } else if (edit.chapter_id) {
        const { data: chap } = await supabase
          .from("chapters")
          .select("content")
          .eq("id", edit.chapter_id)
          .single();
        const newContent =
          edit.kind === "append"
            ? [chap?.content ?? "", edit.proposed_content].filter(Boolean).join("\n\n")
            : edit.proposed_content;
        const { error } = await supabase
          .from("chapters")
          .update({ content: newContent })
          .eq("id", edit.chapter_id);
        if (error) throw error;
      }
      await supabase
        .from("suggested_edits")
        .update({ status: "approved", resolved_at: new Date().toISOString(), resolved_by: user.id })
        .eq("id", edit.id);
      toast.success("Edit applied");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not apply edit");
    }
  };

  const reject = async (edit: Edit) => {
    if (!user) return;
    await supabase
      .from("suggested_edits")
      .update({ status: "rejected", resolved_at: new Date().toISOString(), resolved_by: user.id })
      .eq("id", edit.id);
  };

  const pending = edits.filter((e) => e.status === "pending");
  const resolved = edits.filter((e) => e.status !== "pending");

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-border bg-paper/60 p-3">
        <Button onClick={generate} disabled={generating} className="w-full" variant="secondary">
          <Sparkles className="mr-2 h-4 w-4" />
          {generating ? "Reading the conversation…" : "Generate edits from conversation"}
        </Button>
      </div>
      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {pending.length === 0 && resolved.length === 0 ? (
          <p className="mt-12 text-center text-sm italic text-muted-foreground">
            No suggested edits yet. Have a conversation, then click "Generate edits".
          </p>
        ) : null}

        {pending.map((e) => (
          <div key={e.id} className="rounded-2xl border border-plum/30 bg-paper p-4 shadow-sm">
            <div className="flex items-center gap-2">
              <span className="rounded-full bg-plum/15 px-2 py-0.5 text-xs font-medium text-plum">
                {e.kind === "append" ? "Add to" : e.kind === "replace" ? "Rewrite" : "New chapter"}
              </span>
              <span className="text-xs text-muted-foreground">
                {chapterTitle(e.chapter_id)}
                {e.kind === "new_chapter" && e.proposed_title ? `: ${e.proposed_title}` : ""}
              </span>
            </div>
            <p className="mt-2 text-sm text-foreground">{e.summary}</p>
            <div className="mt-3 max-h-40 overflow-y-auto rounded-md border border-border bg-background/50 p-3 font-serif text-sm leading-relaxed">
              {e.proposed_content}
            </div>
            <div className="mt-3 flex justify-end gap-2">
              <Button size="sm" variant="outline" onClick={() => reject(e)}>
                <X className="mr-1 h-4 w-4" /> Reject
              </Button>
              <Button
                size="sm"
                onClick={() => approve(e)}
                className="bg-sage text-sage-foreground hover:bg-sage/90"
              >
                <Check className="mr-1 h-4 w-4" /> Approve
              </Button>
            </div>
          </div>
        ))}

        {resolved.length > 0 && (
          <>
            <h4 className="mt-6 text-xs uppercase tracking-wide text-muted-foreground">History</h4>
            {resolved.map((e) => (
              <div
                key={e.id}
                className="rounded-xl border border-border bg-paper/50 p-3 text-sm opacity-75"
              >
                <p className="text-xs text-muted-foreground">
                  {e.status === "approved" ? "✓ Applied" : "✕ Rejected"} · {chapterTitle(e.chapter_id)}
                </p>
                <p className="mt-1">{e.summary}</p>
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}
