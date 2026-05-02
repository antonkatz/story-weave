import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type Chapter = {
  id: string;
  title: string;
  content: string;
  position: number;
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
        content: "",
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
                activeId === c.id
                  ? "bg-primary/10 font-medium text-primary"
                  : "hover:bg-secondary"
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
  chapter,
  onSaved,
  onDelete,
}: {
  chapter: Chapter;
  onSaved: () => void;
  onDelete: () => void;
}) {
  const [title, setTitle] = useState(chapter.title);
  const [content, setContent] = useState(chapter.content);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setTitle(chapter.title);
    setContent(chapter.content);
  }, [chapter.id, chapter.title, chapter.content]);

  const save = async () => {
    setSaving(true);
    const { error } = await supabase
      .from("chapters")
      .update({ title: title.trim() || "Untitled", content })
      .eq("id", chapter.id);
    setSaving(false);
    if (error) {
      toast.error("Could not save chapter");
      return;
    }
    toast.success("Saved");
    onSaved();
  };

  return (
    <div className="mx-auto max-w-2xl space-y-4">
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
      <Textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        rows={20}
        placeholder="Begin the chapter…"
        className="resize-none bg-paper font-serif text-base leading-relaxed"
      />
      <div className="flex justify-end">
        <Button onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save chapter"}
        </Button>
      </div>
    </div>
  );
}
