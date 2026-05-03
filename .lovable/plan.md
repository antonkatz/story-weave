# Plan

## 1. Navigate to the affected chapter/section after approving a suggestion

**`SuggestedEdits.tsx`**
- Change `applyAgentAction` so each case **returns** `{ chapterId, sectionId } | null` describing where the edit landed:
  - `add_chapter`, `rename_chapter`, `set_chapter_synopsis`, `set_chapter_theme`, `combine_chapters` → `{ chapterId }`
  - `add_section` → `{ chapterId, sectionId: created.id }` (capture the inserted row's id)
  - `rename_section` / `set_section_purpose` / `remove_section` → look up `chapter_id` from `chapter_sections` before the mutation, return `{ chapterId, sectionId }`
  - `create_quote` → `{ chapterId: p.chapter_id, sectionId: p.section_id ?? null }`
  - `assign_quote` → same
  - `write_section` / `append_to_section` / `replace_section` → fetch `chapter_id` from `chapter_sections` for the given `section_id`, return `{ chapterId, sectionId }`
- `SuggestedEdits` accepts a new prop `onApplied?: (target: { chapterId: string; sectionId: string | null }) => void` and calls it after the row is marked approved.

**`books.$bookId.tsx`**
- Convert the chapters/quotes `Tabs` from uncontrolled to **controlled** (`value`/`onValueChange` + `activeTab` state) so we can switch back to "chapters" automatically when an edit lands.
- Add `selectedSectionId` state; on `onApplied`, set both `selectedChapterId`, `selectedSectionId`, and `activeTab="chapters"`.
- Pass `onApplied` into `<Conversation />` → `<SuggestedEdits />` (Conversation already renders SuggestedEdits, so thread the prop through).

**`Chapters.tsx` / `ChapterEditor`**
- Accept `selectedSectionId` and scroll/highlight the matching `<SectionEditor>` when it changes (use `ref` map + `scrollIntoView` + a temporary `ring-2 ring-primary` class via a `useEffect` timeout, mirroring the message-jump pattern).
- The chapter list already re-selects via `selectedChapterId`, and `chapter_sections` realtime subscription already refreshes the section list, so newly-created sections appear without manual reload.

This single mechanism covers items **1, 2, and 3** (sections, quotes, writing).

## 2. Click-to-dismiss "Applied" toast

In `SuggestedEdits.approve`, capture the toast id and wire `onClick` to dismiss it:
```ts
const id = toast.success("Applied", {
  onClick: () => toast.dismiss(id),
});
```
(Sonner supports `onClick` in toast options; the toast already disappears via auto-close, this just makes a click dismiss it immediately.)

## 3. Export book as PDF + standalone HTML view

**New route `src/routes/books.$bookId.read.tsx`**
- Fetches book, chapters (ordered), sections (ordered), quotes + placements.
- Renders a clean print-friendly layout (serif typography, page margins, no app chrome, `@media print` rules: hide buttons, `page-break-before: always` on each chapter).
- Top toolbar (hidden on print) with:
  - "Download PDF" → `window.print()` (browser save-as-PDF — no extra deps, works in Worker runtime).
  - "Download HTML" → builds a self-contained HTML string (inline `<style>` with the same print CSS, no external assets) and triggers a `Blob` download as `<book-title>.html`.
  - "Back to editor" link.

**Header button in `books.$bookId.tsx`**
- Add an "Export / Read" button next to "Agents" linking to `/books/$bookId/read`.

Why not server-side PDF: TanStack Start's Worker runtime can't run `puppeteer`/`sharp`/native libs (per server-runtime guidance). `window.print()` produces a high-quality PDF with zero dependencies; the standalone HTML download is a literal serialization of the rendered DOM.

## 4. Structure agent on a chapter with no context messages

Current behavior in `run-agents/index.ts` (line ~244) already returns a friendly `message: "No context messages linked to this chapter yet."` (200 OK), and `Chapters.tsx` shows it via `toast.info`. So this is **not an error**, but the UX is dead-endy for chapters that pre-date the context feature.

Fix: when `focusedChapter` is set and the chapter has zero context links, **fall back to all unanalyzed messages for that agent** (same set the global structure agent would see), and prepend a note to the user prompt telling the model to focus its section proposals on the focused chapter. Update toast wording in `runChapterStructureAgent` to clarify when fallback was used (return `{ usedFallback: true }` from the function and surface it).

This way old chapters are still usable, and once the user approves new `add_chapter` actions (which already record `chapter_message_context`), focus mode will work normally.

## Files touched

- `src/components/book/SuggestedEdits.tsx` — return target from appliers, `onApplied` prop, click-to-dismiss toast.
- `src/components/book/Conversation.tsx` — forward `onApplied` to `SuggestedEdits`.
- `src/components/book/Chapters.tsx` — accept + react to `selectedSectionId`, scroll/highlight section.
- `src/routes/books.$bookId.tsx` — controlled tabs, `selectedSectionId` state, wire `onApplied`, add Export button.
- `src/routes/books.$bookId.read.tsx` — **new**, print/HTML export view.
- `src/routeTree.gen.ts` — auto-regenerated.
- `supabase/functions/run-agents/index.ts` — focused-mode fallback when no context links exist.

No DB migrations required.
