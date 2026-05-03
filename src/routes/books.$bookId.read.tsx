import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, Printer, Download } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { RequireAuth } from "@/components/RequireAuth";

export const Route = createFileRoute("/books/$bookId/read")({
  component: () => (
    <RequireAuth>
      <ReadPage />
    </RequireAuth>
  ),
});

type Book = { id: string; title: string; description: string };
type Chapter = { id: string; title: string; position: number; synopsis: string; theme: string };
type Section = { id: string; chapter_id: string; title: string; purpose: string; content: string; position: number };
type Quote = { id: string; text: string };
type Placement = { id: string; quote_id: string; chapter_id: string; section_id: string | null };

function ReadPage() {
  const { bookId } = Route.useParams();
  const [book, setBook] = useState<Book | null>(null);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [placements, setPlacements] = useState<Placement[]>([]);
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
          supabase.from("quotes").select("id,text").eq("book_id", bookId),
          supabase
            .from("quote_placements")
            .select("id,quote_id,chapter_id,section_id")
            .eq("book_id", bookId),
        ]);
      if (!b) {
        toast.error("Could not load book");
        return;
      }
      setBook(b as Book);
      setChapters((ch ?? []) as Chapter[]);
      setSections((sec ?? []) as Section[]);
      setQuotes((q ?? []) as Quote[]);
      setPlacements((pl ?? []) as Placement[]);
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

  const quoteFor = (qid: string) => quotes.find((q) => q.id === qid);

  const renderHTML = () => {
    let html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"/><title>${escapeHtml(
      book.title,
    )}</title><style>${PRINT_CSS}</style></head><body><article class="book">`;
    html += `<header class="book-header"><h1>${escapeHtml(book.title)}</h1>`;
    if (book.description) html += `<p class="desc">${escapeHtml(book.description)}</p>`;
    html += `</header>`;
    for (const c of chapters) {
      html += `<section class="chapter"><h2>${escapeHtml(c.title)}</h2>`;
      if (c.synopsis) html += `<p class="synopsis">${escapeHtml(c.synopsis)}</p>`;
      const chapterQuotes = placements
        .filter((p) => p.chapter_id === c.id && !p.section_id)
        .map((p) => quoteFor(p.quote_id))
        .filter(Boolean);
      for (const q of chapterQuotes) {
        html += `<blockquote>${escapeHtml(q!.text)}</blockquote>`;
      }
      const chapterSections = sections.filter((s) => s.chapter_id === c.id);
      for (const s of chapterSections) {
        html += `<section class="section"><h3>${escapeHtml(s.title)}</h3>`;
        const sectionQuotes = placements
          .filter((p) => p.section_id === s.id)
          .map((p) => quoteFor(p.quote_id))
          .filter(Boolean);
        for (const q of sectionQuotes) {
          html += `<blockquote>${escapeHtml(q!.text)}</blockquote>`;
        }
        if (s.content) {
          html += s.content
            .split(/\n\n+/)
            .map((p) => `<p>${escapeHtml(p)}</p>`)
            .join("");
        }
        html += `</section>`;
      }
      html += `</section>`;
    }
    html += `</article></body></html>`;
    return html;
  };

  const downloadHTML = () => {
    const html = renderHTML();
    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${book.title || "book"}.html`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="min-h-screen bg-background">
      <style>{PRINT_CSS}</style>
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

      <article className="book mx-auto max-w-3xl px-8 py-12">
        <header className="book-header mb-12 text-center">
          <h1 className="font-serif text-4xl font-bold">{book.title}</h1>
          {book.description && <p className="desc mt-2 italic text-muted-foreground">{book.description}</p>}
        </header>
        {chapters.map((c) => {
          const chapterQuotes = placements
            .filter((p) => p.chapter_id === c.id && !p.section_id)
            .map((p) => quoteFor(p.quote_id))
            .filter(Boolean) as Quote[];
          const chapterSections = sections.filter((s) => s.chapter_id === c.id);
          return (
            <section key={c.id} className="chapter mb-16">
              <h2 className="font-serif text-3xl font-semibold">{c.title}</h2>
              {c.synopsis && <p className="synopsis mt-2 italic text-muted-foreground">{c.synopsis}</p>}
              {chapterQuotes.map((q) => (
                <blockquote key={q.id} className="my-4 border-l-4 border-plum/50 pl-4 font-serif italic">
                  {q.text}
                </blockquote>
              ))}
              {chapterSections.map((s) => {
                const sectionQuotes = placements
                  .filter((p) => p.section_id === s.id)
                  .map((p) => quoteFor(p.quote_id))
                  .filter(Boolean) as Quote[];
                return (
                  <section key={s.id} className="section mt-6">
                    <h3 className="font-serif text-xl font-medium">{s.title}</h3>
                    {sectionQuotes.map((q) => (
                      <blockquote
                        key={q.id}
                        className="my-3 border-l-4 border-plum/50 pl-4 font-serif italic"
                      >
                        {q.text}
                      </blockquote>
                    ))}
                    {s.content &&
                      s.content.split(/\n\n+/).map((p, i) => (
                        <p key={i} className="mt-3 font-serif leading-relaxed">
                          {p}
                        </p>
                      ))}
                  </section>
                );
              })}
            </section>
          );
        })}
      </article>
    </div>
  );
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const PRINT_CSS = `
@media print {
  .no-print { display: none !important; }
  .chapter { page-break-before: always; }
  .chapter:first-of-type { page-break-before: auto; }
  body { background: white; color: black; }
}
@page { margin: 1in; }
.book { font-family: Georgia, 'Times New Roman', serif; line-height: 1.7; }
.book h1 { font-size: 2.25rem; text-align: center; margin: 0 0 0.5rem; }
.book h2 { font-size: 1.75rem; margin: 2rem 0 0.5rem; }
.book h3 { font-size: 1.25rem; margin: 1.25rem 0 0.5rem; }
.book p { margin: 0.75rem 0; }
.book blockquote { border-left: 3px solid #888; padding-left: 1rem; margin: 1rem 0; font-style: italic; }
.book .desc, .book .synopsis { font-style: italic; color: #555; }
`;
