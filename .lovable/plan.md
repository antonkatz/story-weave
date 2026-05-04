## 1. Collapsible quotes in export view

Modify `src/components/book/BookReader.tsx`:

**On-screen reader (`BookReader` component):**
- Section quotes: wrap in a collapsible block. Default = collapsed when section has prose (`s.content` non-empty), default = expanded when section has no prose. Render a small toggle button ("Show N quotes" / "Hide quotes") above the quotes list.
- Chapter-level quotes (no section): render expanded by default, with a "Hide quotes" toggle.
- Use local React state per section/chapter (Map keyed by id) to track expand/collapse.

**HTML export (`renderBookHtml`):**
- Use native `<details>`/`<summary>` so the downloaded HTML stays interactive without JS.
  - Section quotes with prose → `<details><summary>Show N quotes</summary>...quotes...</details>` (closed by default).
  - Section quotes when section has no prose → `<details open>` (expanded, but still collapsible).
  - Chapter-level quotes → `<details open>` (expanded, collapsible).
- Add minimal CSS for `<summary>` styling (cursor pointer, muted color, no default marker on print) and a `@media print { details > summary { display:none } details > *:not(summary) { display: block !important } }` rule so printed PDFs always show all quotes.

No changes needed to data loading (`books.$bookId_.read.tsx`, `join.$token.tsx`).

## 2. Drag-to-reorder chapters in the chapter pane

Modify `src/components/book/Chapters.tsx` left-side chapter list (lines ~104-116):

- Add HTML5 drag-and-drop handlers on each chapter button: `draggable`, `onDragStart` (store dragged id), `onDragOver` (preventDefault + visual indicator state), `onDrop` (compute new order).
- Show the existing `GripVertical` icon (already imported but unused) on hover as the drag affordance.
- On drop: locally reorder the array, then persist by updating `position` for affected chapters. To avoid the unique constraint on `(book_id, position)` if one exists, do the update in two phases:
  1. Bulk update all reordered chapter positions to negative offsets (`-1 - newIndex`) in one batched call (or sequential updates).
  2. Then update each to its final non-negative `newIndex`.
  - Implemented as two `Promise.all` loops over `supabase.from("chapters").update({ position }).eq("id", id)`.
- After persistence call `onChange()` to refetch from parent. Realtime subscription elsewhere will keep other clients in sync.
- Add a subtle drop-indicator bar (1px primary line) between items while dragging.
- Disable drag when the user lacks edit rights — there's no role check in this component today, so leave as-is (parent already gates editing); just mirror current behavior.

## Files touched

- `src/components/book/BookReader.tsx` — collapsible quote rendering for screen + HTML export.
- `src/components/book/Chapters.tsx` — drag-and-drop reordering for chapters list.

No DB or edge function changes.
