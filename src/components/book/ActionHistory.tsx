import { useEffect, useState } from "react";
import { Check, X, History } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type HistoryRow = {
  id: string;
  agent: string | null;
  action_type: string | null;
  summary: string;
  status: "approved" | "rejected" | "pending";
  resolved_at: string | null;
  created_at: string;
};

const AGENT_LABEL: Record<string, string> = {
  structure: "Structure",
  quotation: "Quotation",
  writing: "Writing",
  splitter: "Splitter",
};

function timeAgo(iso: string) {
  const d = new Date(iso);
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export function ActionHistory({ bookId }: { bookId: string }) {
  const [rows, setRows] = useState<HistoryRow[]>([]);

  const load = async () => {
    const { data } = await supabase
      .from("suggested_edits")
      .select("id,agent,action_type,summary,status,resolved_at,created_at")
      .eq("book_id", bookId)
      .in("status", ["approved", "rejected"])
      .order("resolved_at", { ascending: false })
      .limit(80);
    setRows((data ?? []) as HistoryRow[]);
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel(`history:${bookId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "suggested_edits", filter: `book_id=eq.${bookId}` },
        () => load(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId]);

  return (
    <div className="flex h-full flex-col border-t border-border bg-paper/60">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <History className="h-3.5 w-3.5" /> Action history ({rows.length})
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-2">
        {rows.length === 0 ? (
          <p className="px-1 py-2 text-xs italic text-muted-foreground">
            No actions yet. Approved or rejected suggestions will appear here.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {rows.map((r) => (
              <li
                key={r.id}
                className="flex items-start gap-2 rounded border border-border bg-background/60 p-2 text-xs"
              >
                <span
                  className={`mt-0.5 inline-flex h-4 w-4 flex-none items-center justify-center rounded-full ${
                    r.status === "approved"
                      ? "bg-sage/20 text-sage"
                      : "bg-destructive/15 text-destructive"
                  }`}
                  title={r.status}
                >
                  {r.status === "approved" ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 leading-snug">{r.summary}</p>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                    {r.agent ? (AGENT_LABEL[r.agent] ?? r.agent) : "—"} ·{" "}
                    {timeAgo(r.resolved_at ?? r.created_at)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
