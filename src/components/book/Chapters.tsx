import { useEffect, useRef, useState } from "react";
import { Plus, Trash2, GripVertical, Quote as QuoteIcon, MessageSquare, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type Chapter = {
  id: string;
  title: string;
  position: number;
  synopsis?: string;
  theme?: string;
};

type Section = {
  id: string;
  chapter_id: string;
  title: string;
  purpose: string;
  content: string;
  position: number;
};

type Quote = {
  id: string;
  text: string;
  source_message_id: string | null;
  speaker_id: string | null;
};

type Placement = {
  id: string;
  quote_id: string;
  chapter_id: string;
  section_id: string | null;
};

export function Chapters({
  bookId,
  chapters,
  onChange,
  selectedChapterId,
  onSelectChapter,
  onJumpToMessage,
  selectedSectionId,
}: {
  bookId: string;
  chapters: Chapter[];
  onChange: () => void;
  selectedChapterId?: string | null;
  onSelectChapter?: (id: string | null) => void;
  onJumpToMessage?: (messageId: string) => void;
  selectedSectionId?: string | null;
}) {
  const [internalId, setInternalId] = useState<string | null>(chapters[0]?.id ?? null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const activeId = selectedChapterId ?? internalId;
  const setActiveId = (id: string | null) => {
    setInternalId(id);
    onSelectChapter?.(id);
  };
  const active = chapters.find((c) => c.id === activeId) ?? null;

  useEffect(() => {
    if (!activeId && chapters[0]) setActiveId(chapters[0].id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapters, activeId]);


  const addChapter = async () => {
    const maxPos = chapters.reduce((m, c) => Math.max(m, c.position), -1) + 1;
    const { data, error } = await supabase
      .from("chapters")
      .insert({
        book_id: bookId,
        title: `Chapter ${chapters.length}`,
        position: maxPos,
      })
      .select("id")
      .single();
    if (error) {
      toast.error("Could not add chapter");
      return;
    }
    onChange();
    setActiveId(data.id);
  };

  const removeChapter = async (id: string) => {
    if (!confirm("Delete this chapter?")) return;
    const { error } = await supabase.from("chapters").delete().eq("id", id);
    if (error) {
      toast.error("Could not delete chapter");
      return;
    }
    onChange();
    if (activeId === id) setActiveId(chapters.find((c) => c.id !== id)?.id ?? null);
  };

  const reorderChapters = async (sourceId: string, targetId: string) => {
    if (sourceId === targetId) return;
    const ordered = [...chapters].sort((a, b) => a.position - b.position);
    const fromIdx = ordered.findIndex((c) => c.id === sourceId);
    const toIdx = ordered.findIndex((c) => c.id === targetId);
    if (fromIdx < 0 || toIdx < 0) return;
    const [moved] = ordered.splice(fromIdx, 1);
    ordered.splice(toIdx, 0, moved);
    // Two-phase update to avoid colliding with any (book_id, position) unique constraint.
    await Promise.all(
      ordered.map((c, i) =>
        supabase.from("chapters").update({ position: -1 - i }).eq("id", c.id),
      ),
    );
    await Promise.all(
      ordered.map((c, i) =>
        supabase.from("chapters").update({ position: i }).eq("id", c.id),
      ),
    );
    onChange();
  };

  return (
    <div className="grid h-full grid-cols-[200px_1fr] divide-x divide-border">
      <div className="flex flex-col overflow-hidden">
        <div className="flex-1 space-y-1 overflow-y-auto p-2">
          {chapters.map((c) => (
            <div
              key={c.id}
              draggable
              onDragStart={(e) => {
                setDraggingId(c.id);
                e.dataTransfer.effectAllowed = "move";
              }}
              onDragOver={(e) => {
                e.preventDefault();
                e.dataTransfer.dropEffect = "move";
                if (draggingId && draggingId !== c.id) setDropTargetId(c.id);
              }}
              onDragLeave={() => {
                if (dropTargetId === c.id) setDropTargetId(null);
              }}
              onDrop={(e) => {
                e.preventDefault();
                const src = draggingId;
                setDraggingId(null);
                setDropTargetId(null);
                if (src) reorderChapters(src, c.id);
              }}
              onDragEnd={() => {
                setDraggingId(null);
                setDropTargetId(null);
              }}
              className={`group relative ${
                dropTargetId === c.id ? "before:absolute before:inset-x-0 before:-top-0.5 before:h-0.5 before:bg-primary" : ""
              } ${draggingId === c.id ? "opacity-50" : ""}`}
            >
              <button
                onClick={() => setActiveId(c.id)}
                className={`flex w-full items-center gap-1 rounded-md px-2 py-2 text-left text-sm transition ${
                  activeId === c.id ? "bg-primary/10 font-medium text-primary" : "hover:bg-secondary"
                }`}
              >
                <GripVertical className="h-3.5 w-3.5 shrink-0 cursor-grab text-muted-foreground opacity-0 group-hover:opacity-100" />
                <span className="truncate">{c.title}</span>
              </button>
            </div>
          ))}
        </div>
        <div className="border-t border-border p-2">
          <Button variant="ghost" size="sm" className="w-full justify-start" onClick={addChapter}>
            <Plus className="mr-2 h-4 w-4" /> Add chapter
          </Button>
        </div>
      </div>
      <div className="overflow-y-auto p-6">
        {active ? (
          <ChapterEditor
            key={active.id}
            bookId={bookId}
            chapter={active}
            onSaved={onChange}
            onDelete={() => removeChapter(active.id)}
            onJumpToMessage={onJumpToMessage}
            selectedSectionId={selectedSectionId ?? null}
          />
        ) : (
          <div className="flex h-full items-center justify-center text-sm italic text-muted-foreground">
            Add a chapter to start writing.
          </div>
        )}
      </div>
    </div>
  );
}

type ContextMessage = {
  id: string;
  message_id: string;
  body: string;
  transcript: string | null;
  kind: "text" | "voice";
  created_at: string;
};

function ChapterEditor({
  bookId,
  chapter,
  onSaved,
  onDelete,
  onJumpToMessage,
  selectedSectionId,
}: {
  bookId: string;
  chapter: Chapter;
  onSaved: () => void;
  onDelete: () => void;
  onJumpToMessage?: (messageId: string) => void;
  selectedSectionId?: string | null;
}) {
  const [title, setTitle] = useState(chapter.title);
  const [synopsis, setSynopsis] = useState(chapter.synopsis ?? "");
  const [theme, setTheme] = useState(chapter.theme ?? "");
  const [saving, setSaving] = useState(false);
  const [sections, setSections] = useState<Section[]>([]);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [placements, setPlacements] = useState<Placement[]>([]);
  const [context, setContext] = useState<ContextMessage[]>([]);
  const [runningAgent, setRunningAgent] = useState(false);
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [highlightedSectionId, setHighlightedSectionId] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedSectionId) return;
    const el = sectionRefs.current[selectedSectionId];
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightedSectionId(selectedSectionId);
    const t = setTimeout(() => setHighlightedSectionId(null), 2000);
    return () => clearTimeout(t);
  }, [selectedSectionId, sections]);

  useEffect(() => {
    setTitle(chapter.title);
    setSynopsis(chapter.synopsis ?? "");
    setTheme(chapter.theme ?? "");
  }, [chapter.id, chapter.title, chapter.synopsis, chapter.theme]);

  const reloadSections = async () => {
    const { data } = await supabase
      .from("chapter_sections")
      .select("id,chapter_id,title,purpose,content,position")
      .eq("chapter_id", chapter.id)
      .order("position");
    setSections((data ?? []) as Section[]);
  };

  const reloadQuotes = async () => {
    const { data: pls } = await supabase
      .from("quote_placements")
      .select("id,quote_id,chapter_id,section_id")
      .eq("chapter_id", chapter.id);
    setPlacements((pls ?? []) as Placement[]);
    const ids = Array.from(new Set((pls ?? []).map((p) => p.quote_id)));
    if (ids.length === 0) {
      setQuotes([]);
      return;
    }
    const { data: qs } = await supabase
      .from("quotes")
      .select("id,text,source_message_id,speaker_id")
      .in("id", ids);
    setQuotes((qs ?? []) as Quote[]);
  };

  const reloadContext = async () => {
    const { data: links } = await supabase
      .from("chapter_message_context")
      .select("id,message_id")
      .eq("chapter_id", chapter.id);
    const msgIds = (links ?? []).map((l) => l.message_id);
    if (msgIds.length === 0) {
      setContext([]);
      return;
    }
    const { data: msgs } = await supabase
      .from("messages")
      .select("id,body,transcript,kind,created_at")
      .in("id", msgIds)
      .order("created_at");
    const linkMap = new Map((links ?? []).map((l) => [l.message_id, l.id]));
    setContext(
      (msgs ?? []).map((m) => ({
        id: linkMap.get(m.id)!,
        message_id: m.id,
        body: m.body,
        transcript: m.transcript,
        kind: m.kind as "text" | "voice",
        created_at: m.created_at,
      })),
    );
  };

  useEffect(() => {
    reloadSections();
    reloadQuotes();
    reloadContext();
    const ch = supabase
      .channel(`chapter-detail:${chapter.id}:${Date.now()}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "chapter_sections", filter: `chapter_id=eq.${chapter.id}` },
        () => reloadSections(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "quote_placements", filter: `chapter_id=eq.${chapter.id}` },
        () => reloadQuotes(),
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "chapter_message_context", filter: `chapter_id=eq.${chapter.id}` },
        () => reloadContext(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapter.id]);

  const runChapterStructureAgent = async () => {
    setRunningAgent(true);
    try {
      const { data, error } = await supabase.functions.invoke("run-agents", {
        body: { bookId, agent: "structure", chapterId: chapter.id },
      });
      if (error) throw error;
      const inserted = (data as { inserted?: number })?.inserted ?? 0;
      const msg = (data as { message?: string })?.message;
      const usedFallback = (data as { usedFallback?: boolean })?.usedFallback;
      if (msg) toast.info(msg);
      else if (usedFallback)
        toast.success(
          `Proposed ${inserted} section change${inserted === 1 ? "" : "s"} (no context messages linked yet — used full conversation).`,
        );
      else toast.success(`Proposed ${inserted} section change${inserted === 1 ? "" : "s"} for this chapter.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not run agent");
    } finally {
      setRunningAgent(false);
    }
  };

  const save = async () => {
    setSaving(true);
    const { error } = await supabase
      .from("chapters")
      .update({ title: title.trim() || "Untitled", synopsis, theme })
      .eq("id", chapter.id);
    setSaving(false);
    if (error) {
      toast.error("Could not save chapter");
      return;
    }
    toast.success("Saved");
    onSaved();
  };

  const addSection = async () => {
    const maxPos = sections.reduce((m, s) => Math.max(m, s.position), -1) + 1;
    const { data, error } = await supabase
      .from("chapter_sections")
      .insert({
        book_id: bookId,
        chapter_id: chapter.id,
        title: `Section ${sections.length + 1}`,
        purpose: "",
        position: maxPos,
      })
      .select("id")
      .single();
    if (error) {
      toast.error("Could not add section");
      return;
    }
    await reloadSections();
    if (data?.id) {
      setHighlightedSectionId(data.id);
      setTimeout(() => {
        sectionRefs.current[data.id]?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 50);
      setTimeout(() => setHighlightedSectionId(null), 2200);
    }
  };

  const sectionQuotes = (sectionId: string) =>
    placements
      .filter((p) => p.section_id === sectionId)
      .map((p) => quotes.find((q) => q.id === p.quote_id))
      .filter(Boolean) as Quote[];

  const chapterLevelQuotes = placements
    .filter((p) => p.section_id === null)
    .map((p) => quotes.find((q) => q.id === p.quote_id))
    .filter(Boolean) as Quote[];

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="flex items-center gap-2">
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="border-none bg-transparent px-0 font-serif !text-3xl font-semibold focus-visible:ring-0"
        />
        <Button variant="ghost" size="icon" onClick={onDelete} aria-label="Delete chapter">
          <Trash2 className="h-4 w-4 text-muted-foreground" />
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs uppercase tracking-wide text-muted-foreground">Synopsis</label>
          <Textarea
            value={synopsis}
            onChange={(e) => setSynopsis(e.target.value)}
            rows={3}
            placeholder="What this chapter is about…"
            className="text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs uppercase tracking-wide text-muted-foreground">Theme</label>
          <Textarea
            value={theme}
            onChange={(e) => setTheme(e.target.value)}
            rows={3}
            placeholder="Theme / purpose / mood…"
            className="text-sm"
          />
        </div>
      </div>

      {chapterLevelQuotes.length > 0 && (
        <div>
          <h4 className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">Chapter quotes</h4>
          <div className="space-y-1.5">
            {chapterLevelQuotes.map((q) => (
              <QuoteCard key={q.id} quote={q} />
            ))}
          </div>
        </div>
      )}

      {context.length > 0 && (
        <div>
          <h4 className="mb-1 text-xs uppercase tracking-wide text-muted-foreground">Context — messages that shaped this chapter</h4>
          <div className="space-y-1">
            {context.map((c) => {
              const txt = c.kind === "voice" ? (c.transcript ?? "[voice]") : c.body;
              return (
                <button
                  key={c.id}
                  onClick={() => onJumpToMessage?.(c.message_id)}
                  className="flex w-full items-start gap-2 rounded border border-border/60 bg-background/40 px-2 py-1.5 text-left text-xs hover:bg-secondary/50"
                >
                  <MessageSquare className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
                  <span className="line-clamp-2 leading-snug">{txt.slice(0, 200)}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div>
        <div className="mb-2 flex items-center justify-between">
          <h4 className="text-xs uppercase tracking-wide text-muted-foreground">Sections</h4>
          <div className="flex gap-1">
            <Button variant="ghost" size="sm" onClick={runChapterStructureAgent} disabled={runningAgent}>
              <Sparkles className="mr-1 h-3.5 w-3.5" /> {runningAgent ? "Running…" : "Run Structure agent"}
            </Button>
            <Button variant="ghost" size="sm" onClick={addSection}>
              <Plus className="mr-1 h-3.5 w-3.5" /> Add section
            </Button>
          </div>
        </div>
        {sections.length === 0 ? (
          <p className="text-xs italic text-muted-foreground">
            No sections yet. The Structure agent can propose some, or add one manually.
          </p>
        ) : (
          <div className="space-y-3">
            {sections.map((s) => (
              <SectionEditor
                key={s.id}
                bookId={bookId}
                section={s}
                quotes={sectionQuotes(s.id)}
                wrapperRef={(el) => {
                  sectionRefs.current[s.id] = el;
                }}
                highlighted={highlightedSectionId === s.id}
              />
            ))}
          </div>
        )}
      </div>

      <div className="flex justify-end">
        <Button onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save chapter"}
        </Button>
      </div>
    </div>
  );
}

function SectionEditor({
  bookId,
  section,
  quotes,
  wrapperRef,
  highlighted,
}: {
  bookId: string;
  section: Section;
  quotes: Quote[];
  wrapperRef?: (el: HTMLDivElement | null) => void;
  highlighted?: boolean;
}) {
  const [title, setTitle] = useState(section.title);
  const [purpose, setPurpose] = useState(section.purpose);
  const [content, setContent] = useState(section.content);
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    setTitle(section.title);
    setPurpose(section.purpose);
    setContent(section.content);
  }, [section.id, section.title, section.purpose, section.content]);

  const save = async () => {
    setSaving(true);
    const { error } = await supabase
      .from("chapter_sections")
      .update({ title, purpose, content })
      .eq("id", section.id);
    setSaving(false);
    if (error) {
      toast.error("Could not save section");
      return;
    }
    toast.success("Section saved");
  };

  const remove = async () => {
    if (!confirm("Delete this section?")) return;
    await supabase.from("chapter_sections").delete().eq("id", section.id);
  };

  const runWriting = async () => {
    setRunning(true);
    try {
      const { data, error } = await supabase.functions.invoke("run-agents", {
        body: { bookId, agent: "writing", sectionId: section.id },
      });
      if (error) throw error;
      const inserted = (data as { inserted?: number })?.inserted ?? 0;
      const msg = (data as { message?: string })?.message;
      if (msg) toast.info(msg);
      else toast.success(`Proposed ${inserted} writing edit${inserted === 1 ? "" : "s"} for this section.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not run agent");
    } finally {
      setRunning(false);
    }
  };

  return (
    <div
      ref={wrapperRef}
      className={`rounded-lg border bg-paper p-3 transition ${highlighted ? "border-primary ring-2 ring-primary" : "border-border"}`}
    >
      <div className="flex items-center gap-2">
        <GripVertical className="h-4 w-4 text-muted-foreground" />
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="border-none bg-transparent px-0 font-serif !text-lg font-semibold focus-visible:ring-0"
        />
        <Button variant="ghost" size="sm" onClick={runWriting} disabled={running} title="Run Writing agent on this section">
          <Sparkles className="mr-1 h-3.5 w-3.5" /> {running ? "Running…" : "Write"}
        </Button>
        <Button variant="ghost" size="icon" onClick={remove} aria-label="Delete section">
          <Trash2 className="h-4 w-4 text-muted-foreground" />
        </Button>
      </div>
      <Input
        value={purpose}
        onChange={(e) => setPurpose(e.target.value)}
        placeholder="Purpose of this section…"
        className="mt-1 text-xs italic"
      />
      {quotes.length > 0 && (
        <div className="mt-2 space-y-1">
          {quotes.map((q) => (
            <QuoteCard key={q.id} quote={q} />
          ))}
        </div>
      )}
      <Textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        rows={6}
        placeholder="Section prose…"
        className="mt-2 resize-none bg-background/50 font-serif text-sm leading-relaxed"
      />
      <div className="mt-2 flex justify-end">
        <Button size="sm" variant="secondary" onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save section"}
        </Button>
      </div>
    </div>
  );
}

function QuoteCard({ quote }: { quote: Quote }) {
  return (
    <div className="flex items-start gap-2 rounded border-l-2 border-plum/50 bg-plum/5 px-2 py-1.5 text-xs italic">
      <QuoteIcon className="mt-0.5 h-3 w-3 shrink-0 text-plum" />
      <p className="leading-snug">"{quote.text}"</p>
    </div>
  );
}
