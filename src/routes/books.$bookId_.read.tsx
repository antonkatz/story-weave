import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, Printer, Download } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { RequireAuth } from "@/components/RequireAuth";
import {
  BookReader,
  renderBookHtml,
  type ReaderBook,
  type ReaderChapter,
  type ReaderSection,
  type ReaderQuote,
  type ReaderPlacement,
} from "@/components/book/BookReader";

export const Route = createFileRoute("/books/$bookId_/read")({
  component: () => (
    <RequireAuth>
      <ReadPage />
    </RequireAuth>
  ),
});

function ReadPage() {
  const { bookId } = Route.useParams();
  const [book, setBook] = useState<ReaderBook | null>(null);
  const [chapters, setChapters] = useState<ReaderChapter[]>([]);
  const [sections, setSections] = useState<ReaderSection[]>([]);
  const [quotes, setQuotes] = useState<ReaderQuote[]>([]);
  const [placements, setPlacements] = useState<ReaderPlacement[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const [{ data: b }, { data: ch }, { data: sec }, { data: q }, { data: pl }] =
        await Promise.all([
          supabase.from("books").select("id,title,description").eq("id", bookId).maybeSingle(),
          supabase
            .from("chapters")
            .select("id,title,position,synopsis,theme")
            .eq("book_id", bookId)
            .order("position"),
          supabase
            .from("chapter_sections")
            .select("id,chapter_id,title,purpose,content,position")
            .eq("book_id", bookId)
            .order("position"),
          supabase.from("quotes").select("id,text,speaker_id").eq("book_id", bookId),
          supabase
            .from("quote_placements")
            .select("id,quote_id,chapter_id,section_id")
            .eq("book_id", bookId),
        ]);
      if (!b) {
        toast.error("Could not load book");
        return;
      }
      const speakerIds = Array.from(new Set(((q ?? []) as any[]).map((x) => x.speaker_id).filter(Boolean)));
      const { data: profs } = speakerIds.length
        ? await supabase.from("profiles").select("id,display_name").in("id", speakerIds)
        : { data: [] as any[] };
      const nameOf = (id: string | null) =>
        (profs ?? []).find((p: any) => p.id === id)?.display_name ?? null;
      const quotesWithAuthor = ((q ?? []) as any[]).map((x) => ({
        id: x.id,
        text: x.text,
        author_name: nameOf(x.speaker_id),
      }));
      setBook(b as ReaderBook);
      setChapters((ch ?? []) as ReaderChapter[]);
      setSections((sec ?? []) as ReaderSection[]);
      setQuotes((q ?? []) as ReaderQuote[]);
      setPlacements((pl ?? []) as ReaderPlacement[]);
      setLoading(false);
    })();
  }, [bookId]);

  if (loading || !book) {
    return (
      <div className="flex min-h-screen items-center justify-center text-muted-foreground">
        Loading book…
      </div>
    );
  }

  const downloadHTML = () => {
    const html = renderBookHtml(book, chapters, sections, quotes, placements);
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${book.title || "book"}.html`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <BookReader
      book={book}
      chapters={chapters}
      sections={sections}
      quotes={quotes}
      placements={placements}
      banner={
        <div className="no-print sticky top-0 z-10 border-b border-border bg-paper">
          <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-3">
            <Button variant="ghost" size="sm" asChild>
              <Link to="/books/$bookId" params={{ bookId }}>
                <ArrowLeft className="mr-1 h-4 w-4" /> Back to editor
              </Link>
            </Button>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={downloadHTML}>
                <Download className="mr-1.5 h-4 w-4" /> Download HTML
              </Button>
              <Button size="sm" onClick={() => window.print()}>
                <Printer className="mr-1.5 h-4 w-4" /> Print / Save as PDF
              </Button>
            </div>
          </div>
        </div>
      }
    />
  );
}
