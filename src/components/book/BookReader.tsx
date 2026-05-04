// Shared book reader rendering used in /books/$bookId/read and /join/$token.
import { useState, type ReactNode } from "react";

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
  details > summary { display: none !important; }
  details > *:not(summary) { display: block !important; }
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
.book details { margin: 0.75rem 0; }
.book details > summary { cursor: pointer; color: #666; font-size: 0.875rem; font-style: italic; list-style: none; user-select: none; padding: 0.25rem 0; }
.book details > summary::-webkit-details-marker { display: none; }
.book details > summary::before { content: '▸ '; display: inline-block; transition: transform 0.15s; }
.book details[open] > summary::before { content: '▾ '; }
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
  const renderQuotesBlock = (qs: ReaderQuote[], open: boolean) => {
    if (qs.length === 0) return "";
    const label = open
      ? `Hide ${qs.length} quote${qs.length === 1 ? "" : "s"}`
      : `Show ${qs.length} quote${qs.length === 1 ? "" : "s"}`;
    const inner = qs
      // TEMP: author hidden in export
      .map((q) => `<blockquote>${escapeHtml(q.text)}</blockquote>`)
      .join("");
    return `<details${open ? " open" : ""}><summary>${label}</summary>${inner}</details>`;
  };
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
      .filter(Boolean) as ReaderQuote[];
    // Chapter-level quotes: expanded by default, still collapsible.
    html += renderQuotesBlock(chapterQuotes, true);
    const chapterSections = sections.filter((s) => s.chapter_id === c.id);
    for (const s of chapterSections) {
      html += `<section class="section"><h3>${escapeHtml(s.title)}</h3>`;
      const sectionQuotes = placements
        .filter((p) => p.section_id === s.id)
        .map((p) => quoteFor(p.quote_id))
        .filter(Boolean) as ReaderQuote[];
      const hasProse = !!s.content && s.content.trim().length > 0;
      // If no prose, expand quotes by default; otherwise collapse them.
      html += renderQuotesBlock(sectionQuotes, !hasProse);
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

function CollapsibleQuotes({
  quotes,
  defaultOpen,
}: {
  quotes: ReaderQuote[];
  defaultOpen: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  if (quotes.length === 0) return null;
  return (
    <div className="my-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="no-print mb-1 text-xs italic text-muted-foreground hover:text-foreground"
      >
        {open ? "▾ " : "▸ "}
        {open
          ? `Hide ${quotes.length} quote${quotes.length === 1 ? "" : "s"}`
          : `Show ${quotes.length} quote${quotes.length === 1 ? "" : "s"}`}
      </button>
      {open && (
        <div>
          {quotes.map((q) => (
            <blockquote
              key={q.id}
              className="my-3 border-l-4 border-plum/50 pl-4 font-serif italic"
            >
              {q.text}
              {/* TEMP: author hidden in export */}
            </blockquote>
          ))}
        </div>
      )}
    </div>
  );
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
              {/* Chapter-level quotes: expanded by default. */}
              <CollapsibleQuotes quotes={chapterQuotes} defaultOpen={true} />
              {chapterSections.map((s) => {
                const sectionQuotes = placements
                  .filter((p) => p.section_id === s.id)
                  .map((p) => quoteFor(p.quote_id))
                  .filter(Boolean) as ReaderQuote[];
                const hasProse = !!s.content && s.content.trim().length > 0;
                return (
                  <section key={s.id} className="section mt-6">
                    <h3 className="font-serif text-xl font-medium">{s.title}</h3>
                    {/* If section has no prose, show all quotes by default. */}
                    <CollapsibleQuotes quotes={sectionQuotes} defaultOpen={!hasProse} />
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
