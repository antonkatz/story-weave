import { useEffect, useState } from "react";
import { Plus, Trash2, GripVertical, Quote as QuoteIcon } from "lucide-react";
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
}: {
  bookId: string;
  chapters: Chapter[];
  onChange: () => void;
}) {
  const [activeId, setActiveId] = useState<string | null>(chapters[0]?.id ?? null);
  const active = chapters.find((c) => c.id === activeId) ?? null;

  useEffect(() => {
    if (!activeId && chapters[0]) setActiveId(chapters[0].id);
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

  return (
    <div className="grid h-full grid-cols-[200px_1fr] divide-x divide-border">
      <div className="flex flex-col overflow-hidden">
        <div className="flex-1 space-y-1 overflow-y-auto p-2">
          {chapters.map((c) => (
            <button
              key={c.id}
              onClick={() => setActiveId(c.id)}
              className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm transition ${
                activeId === c.id ? "bg-primary/10 font-medium text-primary" : "hover:bg-secondary"
              }`}
            >
              <span className="truncate">{c.title}</span>
            </button>
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

function ChapterEditor({
  bookId,
  chapter,
  onSaved,
  onDelete,
}: {
  bookId: string;
  chapter: Chapter;
  onSaved: () => void;
  onDelete: () => void;
}) {
  const [title, setTitle] = useState(chapter.title);
  const [synopsis, setSynopsis] = useState(chapter.synopsis ?? "");
  const [theme, setTheme] = useState(chapter.theme ?? "");
  const [saving, setSaving] = useState(false);
  const [sections, setSections] = useState<Section[]>([]);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [placements, setPlacements] = useState<Placement[]>([]);

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

  useEffect(() => {
    reloadSections();
    reloadQuotes();
    const ch = supabase
      .channel(`chapter-detail:${chapter.id}`)
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
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chapter.id]);

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
    const { error } = await supabase.from("chapter_sections").insert({
      book_id: bookId,
      chapter_id: chapter.id,
      title: `Section ${sections.length + 1}`,
      purpose: "",
      position: maxPos,
    });
    if (error) toast.error("Could not add section");
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

      <div>
        <div className="mb-2 flex items-center justify-between">
          <h4 className="text-xs uppercase tracking-wide text-muted-foreground">Sections</h4>
          <Button variant="ghost" size="sm" onClick={addSection}>
            <Plus className="mr-1 h-3.5 w-3.5" /> Add section
          </Button>
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
                section={s}
                quotes={sectionQuotes(s.id)}
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

function SectionEditor({ section, quotes }: { section: Section; quotes: Quote[] }) {
  const [title, setTitle] = useState(section.title);
  const [purpose, setPurpose] = useState(section.purpose);
  const [content, setContent] = useState(section.content);
  const [saving, setSaving] = useState(false);

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

  return (
    <div className="rounded-lg border border-border bg-paper p-3">
      <div className="flex items-center gap-2">
        <GripVertical className="h-4 w-4 text-muted-foreground" />
        <Input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="border-none bg-transparent px-0 font-serif !text-lg font-semibold focus-visible:ring-0"
        />
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
