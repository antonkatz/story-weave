// Shared book reader rendering used in /books/$bookId/read and /join/$token.
import type { ReactNode } from "react";

export type ReaderBook = { id: string; title: string; description: string };
export type ReaderChapter = { id: string; title: string; position: number; synopsis?: string; theme?: string };
export type ReaderSection = {
  id: string;
  chapter_id: string;
  title: string;
  purpose?: string;
  content: string;
  position: number;
};
export type ReaderQuote = { id: string; text: string; author_name?: string | null };
export type ReaderPlacement = { id: string; quote_id: string; chapter_id: string; section_id: string | null };

export const PRINT_CSS = `
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
.book blockquote .cite { display: block; margin-top: 0.25rem; font-style: normal; font-size: 0.875rem; color: #666; }
.book .desc, .book .synopsis { font-style: italic; color: #555; }
`;

export function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function renderBookHtml(
  book: ReaderBook,
  chapters: ReaderChapter[],
  sections: ReaderSection[],
  quotes: ReaderQuote[],
  placements: ReaderPlacement[],
) {
  const quoteFor = (qid: string) => quotes.find((q) => q.id === qid);
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
      const cite = q!.author_name ? `<footer class="cite">— ${escapeHtml(q!.author_name)}</footer>` : "";
      html += `<blockquote>${escapeHtml(q!.text)}${cite}</blockquote>`;
    }
    const chapterSections = sections.filter((s) => s.chapter_id === c.id);
    for (const s of chapterSections) {
      html += `<section class="section"><h3>${escapeHtml(s.title)}</h3>`;
      const sectionQuotes = placements
        .filter((p) => p.section_id === s.id)
        .map((p) => quoteFor(p.quote_id))
        .filter(Boolean);
      for (const q of sectionQuotes) {
        const cite = q!.author_name ? `<footer class="cite">— ${escapeHtml(q!.author_name)}</footer>` : "";
        html += `<blockquote>${escapeHtml(q!.text)}${cite}</blockquote>`;
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
}

export function BookReader({
  book,
  chapters,
  sections,
  quotes,
  placements,
  banner,
}: {
  book: ReaderBook;
  chapters: ReaderChapter[];
  sections: ReaderSection[];
  quotes: ReaderQuote[];
  placements: ReaderPlacement[];
  banner?: ReactNode;
}) {
  const quoteFor = (qid: string) => quotes.find((q) => q.id === qid);
  return (
    <div className="min-h-screen bg-background">
      <style>{PRINT_CSS}</style>
      {banner}
      <article className="book mx-auto max-w-3xl px-8 py-12">
        <header className="book-header mb-12 text-center">
          <h1 className="font-serif text-4xl font-bold">{book.title}</h1>
          {book.description && (
            <p className="desc mt-2 italic text-muted-foreground">{book.description}</p>
          )}
        </header>
        {chapters.map((c) => {
          const chapterQuotes = placements
            .filter((p) => p.chapter_id === c.id && !p.section_id)
            .map((p) => quoteFor(p.quote_id))
            .filter(Boolean) as ReaderQuote[];
          const chapterSections = sections.filter((s) => s.chapter_id === c.id);
          return (
            <section key={c.id} className="chapter mb-16">
              <h2 className="font-serif text-3xl font-semibold">{c.title}</h2>
              {c.synopsis && (
                <p className="synopsis mt-2 italic text-muted-foreground">{c.synopsis}</p>
              )}
              {chapterQuotes.map((q) => (
                <blockquote
                  key={q.id}
                  className="my-4 border-l-4 border-plum/50 pl-4 font-serif italic"
                >
                  {q.text}
                  {q.author_name && (
                    <footer className="mt-1 text-sm not-italic text-muted-foreground">— {q.author_name}</footer>
                  )}
                </blockquote>
              ))}
              {chapterSections.map((s) => {
                const sectionQuotes = placements
                  .filter((p) => p.section_id === s.id)
                  .map((p) => quoteFor(p.quote_id))
                  .filter(Boolean) as ReaderQuote[];
                return (
                  <section key={s.id} className="section mt-6">
                    <h3 className="font-serif text-xl font-medium">{s.title}</h3>
                    {sectionQuotes.map((q) => (
                      <blockquote
                        key={q.id}
                        className="my-3 border-l-4 border-plum/50 pl-4 font-serif italic"
                      >
                        {q.text}
                        {q.author_name && (
                          <footer className="mt-1 text-sm not-italic text-muted-foreground">— {q.author_name}</footer>
                        )}
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
