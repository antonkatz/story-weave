import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

export type AgentKind = "structure" | "quotation" | "writing" | "splitter";

const AGENTS: { id: AgentKind; label: string; description: string }[] = [
  { id: "structure", label: "Structure", description: "Designs chapters, synopses, themes, and sections." },
  { id: "splitter", label: "Splitter", description: "Splits long or multi-speaker messages into smaller messages." },
  { id: "quotation", label: "Quotation", description: "Pulls verbatim quotes from messages and assigns them." },
  { id: "writing", label: "Writing", description: "Combines quotes into cohesive prose for each section." },
];

type Prompts = Record<AgentKind, string>;

/**
 * Editor for agent prompts.
 *  - When `bookId` is undefined: edits the global prompts (`agent_prompts_global`).
 *  - When `bookId` is provided: edits per-book overrides (`book_agent_prompts`),
 *    and shows the inherited global prompt as fallback.
 */
export function AgentPromptsEditor({ bookId }: { bookId?: string }) {
  const [globals, setGlobals] = useState<Prompts>({ structure: "", quotation: "", writing: "", splitter: "" });
  const [overrides, setOverrides] = useState<Partial<Prompts>>({});
  const [drafts, setDrafts] = useState<Prompts>({ structure: "", quotation: "", writing: "", splitter: "" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<AgentKind | null>(null);

  useEffect(() => {
    let active = true;
    (async () => {
      const [{ data: g }, ovRes] = await Promise.all([
        supabase.from("agent_prompts_global").select("agent,prompt"),
        bookId
          ? supabase.from("book_agent_prompts").select("agent,prompt").eq("book_id", bookId)
          : Promise.resolve({ data: [] as { agent: AgentKind; prompt: string }[] }),
      ]);
      if (!active) return;
      const gMap: Prompts = { structure: "", quotation: "", writing: "", splitter: "" };
      for (const row of g ?? []) gMap[row.agent as AgentKind] = row.prompt;
      const oMap: Partial<Prompts> = {};
      for (const row of (ovRes.data ?? []) as { agent: AgentKind; prompt: string }[]) {
        oMap[row.agent] = row.prompt;
      }
      setGlobals(gMap);
      setOverrides(oMap);
      // initial draft = override if present, else global
      setDrafts({
        structure: oMap.structure ?? gMap.structure,
        quotation: oMap.quotation ?? gMap.quotation,
        writing: oMap.writing ?? gMap.writing,
      });
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [bookId]);

  const save = async (agent: AgentKind) => {
    setSaving(agent);
    try {
      const prompt = drafts[agent];
      if (bookId) {
        const { error } = await supabase
          .from("book_agent_prompts")
          .upsert({ book_id: bookId, agent, prompt }, { onConflict: "book_id,agent" });
        if (error) throw error;
        setOverrides((prev) => ({ ...prev, [agent]: prompt }));
        toast.success("Override saved");
      } else {
        const { error } = await supabase
          .from("agent_prompts_global")
          .upsert({ agent, prompt }, { onConflict: "agent" });
        if (error) throw error;
        setGlobals((prev) => ({ ...prev, [agent]: prompt }));
        toast.success("Global prompt saved");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSaving(null);
    }
  };

  const resetToGlobal = async (agent: AgentKind) => {
    if (!bookId) return;
    const { error } = await supabase
      .from("book_agent_prompts")
      .delete()
      .eq("book_id", bookId)
      .eq("agent", agent);
    if (error) {
      toast.error("Could not reset");
      return;
    }
    setOverrides((prev) => {
      const next = { ...prev };
      delete next[agent];
      return next;
    });
    setDrafts((prev) => ({ ...prev, [agent]: globals[agent] }));
    toast.success("Reset to global");
  };

  if (loading) return <p className="p-4 text-sm text-muted-foreground">Loading prompts…</p>;

  return (
    <Tabs defaultValue="structure" className="w-full">
      <TabsList className="grid w-full grid-cols-3">
        {AGENTS.map((a) => (
          <TabsTrigger key={a.id} value={a.id}>
            {a.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {AGENTS.map((a) => {
        const hasOverride = bookId && overrides[a.id] !== undefined;
        return (
          <TabsContent key={a.id} value={a.id} className="space-y-3">
            <p className="text-sm text-muted-foreground">{a.description}</p>
            {bookId && (
              <p className="text-xs italic text-muted-foreground">
                {hasOverride ? "Using book-specific override." : "Inherited from global."}
              </p>
            )}
            <Textarea
              value={drafts[a.id]}
              onChange={(e) => setDrafts((prev) => ({ ...prev, [a.id]: e.target.value }))}
              rows={14}
              className="font-mono text-xs"
            />
            <div className="flex justify-end gap-2">
              {bookId && hasOverride && (
                <Button variant="outline" size="sm" onClick={() => resetToGlobal(a.id)}>
                  Reset to global
                </Button>
              )}
              <Button size="sm" onClick={() => save(a.id)} disabled={saving === a.id}>
                {saving === a.id ? "Saving…" : bookId ? "Save override" : "Save global"}
              </Button>
            </div>
          </TabsContent>
        );
      })}
    </Tabs>
  );
}
