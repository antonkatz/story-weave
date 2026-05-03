## 1. Remove legacy `chapters.content`

**DB migration:**
- `ALTER TABLE chapters DROP COLUMN content;`
- Drop legacy enum values / columns on `suggested_edits` that only made sense for whole-chapter prose: keep `proposed_content` (still used by `write_section`) but the legacy `kind` / `proposed_title` fallback path becomes dead. Leave the columns (data already there) but stop writing to them.

**UI (`src/components/book/Chapters.tsx`):**
- Remove `content` from `Chapter` type, from `ChapterEditor` state, from the `<details>Free-form chapter content (legacy)</details>` block, and from the `update({ content })` call in `save()`.
- Remove `content: ""` from `addChapter` insert.

**Backend (`run-agents/index.ts`):** no change needed — it never read `chapters.content`.

**SuggestedEdits applier:** remove `applyLegacyEdit` branch for `append`/`replace` against `chapters.content`. Keep `new_chapter` legacy path but without content (or drop entirely — there should be no legacy rows worth keeping).

## 2. Fix `add_section` "missing chapter_id"

The Structure agent emits `add_section` with a `chapter_id` *inside the payload*, but the run-agents code only copies `a.chapter_id` onto the row's top-level `chapter_id` column. The applier reads `edit.chapter_id` (top-level). That should already work — but for **newly added chapters in the same batch**, the agent has no real id to reference, so it leaves `chapter_id` null.

**Fix:**
- `SuggestedEdits.tsx` → `add_section` case: if `edit.chapter_id` is null, fall back to `payload.chapter_id`. If still null, surface a clearer error: *"This section was proposed for a new chapter — approve the add_chapter first, then re-run agents."*
- Tighten the structure agent prompt context: emphasize that `chapter_id` MUST be one of the listed existing ids; do not invent ids; if the section belongs to a not-yet-created chapter, skip it this round.

## 3. Per-agent run buttons

**Backend:** accept `{ bookId, agent?: "structure" | "quotation" | "writing" | "all" }`. Run only that agent (skip the others, do not mark messages as analyzed unless `all` finished — see below). Return `{ inserted, agent }`.

**Mark analyzed semantics:** only mark messages `analyzed_at` after the agent that ran completes. Add a per-agent tracking column:
- New table `message_agent_analysis (message_id, agent, analyzed_at, primary key (message_id, agent))`.
- The query for "unanalyzed messages" becomes per-agent: messages without a row for that agent.
- Drop reliance on `messages.analyzed_at` going forward (keep column for now as legacy).

**UI (`Conversation.tsx`):**
- Replace the single "Run agents" pill with three buttons: "Run Structure", "Run Quotation", "Run Writing" (each shows count of messages unanalyzed *for that agent*).
- Compute counts via a small query against `message_agent_analysis` left-joined with messages, refreshed on realtime message inserts.

Sequential constraint is gone — user picks order. (Quotation still needs structure ids to exist for `assign_quote`, but that's already a soft constraint surfaced as a friendly error.)

## 4. Agents must see existing book content

Currently the prompts include chapter titles/synopses/themes/section titles/purposes — but not the **section prose** the writing agent has already produced, nor existing quote text in full.

**Update `chaptersText` builder in `run-agents`:**
- For each section include `content` (truncated to ~800 chars) so agents avoid duplicating prose.
- For each chapter include count of placed quotes per section.

**Add a "Book context" block to all three agent prompts** with: book title + description (fetch from `books`), full chapter outline including section content excerpts, and the full text of all existing quotes (not just `id` + first 200 chars — bump to 500 and include speaker).

## 5. Fix `create_quote` "could not apply"

`quotes.text` is `NOT NULL`. The agent sometimes emits `create_quote` with `text: null` (the schema declares `text: ["string","null"]`). The applier throws "Missing quote text" → toast says "could not apply".

**Fixes:**
- Tighten tool schema: `text` for `create_quote` should be required non-null. Mark `quote_ref` required too, and split into two tool entries (`create_quote` vs `assign_quote`) or use per-action validation server-side before pushing to `suggested_edits` (skip malformed actions, log them).
- Also: `source_message_id` may be a fabricated string — validate it against the message ids passed in; if invalid, store `null` instead of letting an FK-less insert succeed but break later joins.
- In `SuggestedEdits.tsx`, surface the actual error string from Supabase (currently we only show generic "could not apply" because we throw a generic Error). Replace with `e.message ?? e.toString()` already in place — verify the inner error is propagated, not swallowed.

## Files touched

- `supabase/migrations/<new>.sql` — drop `chapters.content`; create `message_agent_analysis`.
- `supabase/functions/run-agents/index.ts` — per-agent mode, richer context, input validation, per-agent analyzed tracking.
- `src/components/book/Chapters.tsx` — remove legacy content UI + field.
- `src/components/book/Conversation.tsx` — three per-agent buttons with counts.
- `src/components/book/SuggestedEdits.tsx` — payload fallbacks, clearer errors, drop legacy chapter-content appliers.

No new env/secrets needed.