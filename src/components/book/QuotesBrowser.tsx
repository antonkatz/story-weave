import { useEffect, useState } from "react";
import { Quote as QuoteIcon, Trash2, MapPin } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

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

type Chapter = { id: string; title: string };
type Section = { id: string; chapter_id: string; title: string };

export function QuotesBrowser({
  bookId,
  chapters,
  onJumpToChapter,
}: {
  bookId: string;
  chapters: Chapter[];
  onJumpToChapter: (chapterId: string, sectionId: string | null) => void;
}) {
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [placements, setPlacements] = useState<Placement[]>([]);
  const [sections, setSections] = useState<Section[]>([]);

  const reload = async () => {
    const [{ data: q }, { data: pl }, { data: sec }] = await Promise.all([
      supabase.from("quotes").select("id,text,source_message_id,speaker_id").eq("book_id", bookId),
      supabase.from("quote_placements").select("id,quote_id,chapter_id,section_id").eq("book_id", bookId),
      supabase.from("chapter_sections").select("id,chapter_id,title").eq("book_id", bookId),
    ]);
    setQuotes((q ?? []) as Quote[]);
    setPlacements((pl ?? []) as Placement[]);
    setSections((sec ?? []) as Section[]);
  };

  useEffect(() => {
    reload();
    const ch = supabase
      .channel(`quotes-browser:${bookId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "quotes", filter: `book_id=eq.${bookId}` }, reload)
      .on("postgres_changes", { event: "*", schema: "public", table: "quote_placements", filter: `book_id=eq.${bookId}` }, reload)
      .on("postgres_changes", { event: "*", schema: "public", table: "chapter_sections", filter: `book_id=eq.${bookId}` }, reload)
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId]);

  const chapterTitle = (id: string) => chapters.find((c) => c.id === id)?.title ?? "(missing chapter)";
  const sectionTitle = (id: string | null) => (id ? sections.find((s) => s.id === id)?.title ?? "(missing section)" : null);

  const deleteQuote = async (id: string) => {
    if (!confirm("Delete this quote and all its placements?")) return;
    await supabase.from("quote_placements").delete().eq("quote_id", id);
    const { error } = await supabase.from("quotes").delete().eq("id", id);
    if (error) toast.error("Could not delete quote");
  };

  const removePlacement = async (id: string) => {
    const { error } = await supabase.from("quote_placements").delete().eq("id", id);
    if (error) toast.error("Could not unplace");
  };

  const addPlacement = async (quoteId: string, value: string) => {
    // value is "chapterId" or "chapterId:sectionId"
    const [chapter_id, section_id] = value.split(":");
    const { error } = await supabase.from("quote_placements").insert({
      book_id: bookId,
      quote_id: quoteId,
      chapter_id,
      section_id: section_id || null,
    });
    if (error) toast.error("Could not add placement");
  };

  if (quotes.length === 0) {
    return (
      <div className="p-6 text-sm italic text-muted-foreground">
        No quotes yet. The Quotation agent extracts them from the conversation.
      </div>
    );
  }

  return (
    <div className="space-y-3 overflow-y-auto p-4">
      {quotes.map((q) => {
        const places = placements.filter((p) => p.quote_id === q.id);
        return (
          <div key={q.id} className="rounded-lg border border-border bg-paper p-3 shadow-sm">
            <div className="flex items-start gap-2">
              <QuoteIcon className="mt-0.5 h-4 w-4 shrink-0 text-plum" />
              <p className="flex-1 font-serif text-sm italic leading-relaxed">"{q.text}"</p>
              <Button variant="ghost" size="icon" onClick={() => deleteQuote(q.id)} aria-label="Delete quote">
                <Trash2 className="h-4 w-4 text-muted-foreground" />
              </Button>
            </div>
            <div className="mt-2 space-y-1">
              {places.length === 0 ? (
                <p className="text-xs italic text-muted-foreground">Not placed in any chapter.</p>
              ) : (
                places.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center justify-between rounded border border-border/60 bg-background/40 px-2 py-1 text-xs"
                  >
                    <button
                      onClick={() => onJumpToChapter(p.chapter_id, p.section_id)}
                      className="flex items-center gap-1.5 text-left hover:text-primary"
                    >
                      <MapPin className="h-3 w-3" />
                      <span className="font-medium">{chapterTitle(p.chapter_id)}</span>
                      {p.section_id && (
                        <span className="text-muted-foreground">→ {sectionTitle(p.section_id)}</span>
                      )}
                    </button>
                    <Button size="sm" variant="ghost" onClick={() => removePlacement(p.id)}>
                      Unplace
                    </Button>
                  </div>
                ))
              )}
            </div>
            <div className="mt-2">
              <Select onValueChange={(v) => addPlacement(q.id, v)}>
                <SelectTrigger className="h-7 text-xs">
                  <SelectValue placeholder="+ Add placement" />
                </SelectTrigger>
                <SelectContent>
                  {chapters.map((c) => (
                    <div key={c.id}>
                      <SelectItem value={c.id}>{c.title} (chapter)</SelectItem>
                      {sections
                        .filter((s) => s.chapter_id === c.id)
                        .map((s) => (
                          <SelectItem key={s.id} value={`${c.id}:${s.id}`}>
                            {c.title} → {s.title}
                          </SelectItem>
                        ))}
                    </div>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        );
      })}
    </div>
  );
}
