## Goal

Extend the Literary Agents system with quote-chapter coupling, a Quotes browser, message→chapter context links, and a per-chapter Structure agent run.

## 1. Quotes always assigned to a chapter

**Edge function (`run-agents`)** — Quotation agent:

- Update the tool prompt + post-processing so every `create_quote` action also carries a `chapter_id` (and optionally `section_id`). If the model omits it, drop the action (or fall back to the first chapter when there's only one).
- After the quote is created, the existing `assign_quote` flow remains for additional placements.

**Applier (`SuggestedEdits.tsx`)**:

- `create_quote` case: insert into `quotes`, then in the same transaction insert a `quote_placements` row using `payload.chapter_id` (+ optional `section_id`). Reject if no valid chapter exists.

## 2. Quotes browser tab

**New tab system on the chapters pane** (`src/routes/books.$bookId.tsx`):

- Replace the static "Chapters" header in the left pane with a small Tabs control: **Chapters** | **Quotes**.
- New component `src/components/book/QuotesBrowser.tsx`:
  - Lists every quote in the book with text, source message preview, speaker, and a list of chapter/section placements.
  - Each placement row is clickable → selects that chapter (and section if any) in the Chapters tab.
  - Allow basic actions: delete quote, copy placement to a different chapter/section (simple selects), unplace. Since a quote can be assigned to multiple chapters/sections, the unplace action must be specific to the chapter/section. 

## 3. Quotes can attach at chapter level (no section)

Already supported by schema (`quote_placements.section_id` is nullable). Make sure:

- Quotation agent prompt explicitly allows `section_id: null`.
- `assign_quote` applier already allows null section_id ✓ — no change needed beyond prompt clarity.
- Quotes browser exposes "Chapter only" as a placement option.

## 4. Chapter "Context" — message references

**Schema (new migration)** — `chapter_message_context` table:

```text
chapter_message_context (
  id uuid pk default gen_random_uuid(),
  book_id uuid not null,
  chapter_id uuid not null,
  message_id uuid not null,
  created_at timestamptz default now(),
  unique (chapter_id, message_id)
)
```

With RLS mirroring `chapter_sections` (member-based via `is_book_member(book_id, ...)`).

**Auto-population**:

- When the **Structure agent** creates a chapter via `add_chapter`, record the analyzed message ids that produced it. Easiest path: the edge function returns the new-message ids it analyzed and the applier links them when an `add_chapter` action is approved. Implementation: include `source_message_ids: string[]` in the `add_chapter` payload (the edge function attaches the current batch of `newMessages` ids), and the applier inserts them into `chapter_message_context` after creating the chapter.
- Same for `add_section` so we know which conversation triggered it (optional).

**UI in `Chapters.tsx**` (chapter editor):

- New "Context" section listing referenced messages (author + timestamp + first ~120 chars of body/transcript).
- Each item is a button that calls a new `onJumpToMessage(messageId)` callback passed down from `books.$bookId.tsx`.
- `Conversation.tsx` accepts a `jumpToMessageId` prop; on change it scrolls the matching message into view and applies a brief highlight ring.
- Manual add/remove of context messages (small "+ link message" picker) — optional, defer if scope tight.

## 5. Per-chapter Structure agent

**Edge function** — extend `run-agents`:

- Accept optional `chapterId` in the body. When present and `agent === "structure"`:
  - Restrict `newMessages` to messages linked to that chapter via `chapter_message_context` (regardless of analysis state).
  - Tighten the system prompt to say: "Only propose section-level actions for chapter `<id>` — add_section / rename_section / set_section_purpose / remove_section / merging via remove_section + new add_section. Do not touch other chapters."
  - Skip the `message_agent_analysis` upsert in this mode (it's a focused re-run, not a global pass).

**UI in `Chapters.tsx**` chapter editor:

- New button "Run Structure agent on this chapter" near the Sections header.
- Calls `supabase.functions.invoke("run-agents", { body: { bookId, agent: "structure", chapterId } })`.
- Resulting `suggested_edits` show up in the same SuggestedEdits panel in the conversation pane (no change needed there).

## Files to touch / add

- `supabase/migrations/<ts>_chapter_message_context.sql` (new)
- `supabase/functions/run-agents/index.ts` (chapter scoping, quote→chapter coupling, source_message_ids on add_chapter)
- `src/components/book/SuggestedEdits.tsx` (create_quote inserts placement; add_chapter inserts context links)
- `src/components/book/QuotesBrowser.tsx` (new)
- `src/components/book/Chapters.tsx` (Context list, jump callback, per-chapter Structure run button)
- `src/components/book/Conversation.tsx` (accept `jumpToMessageId`, scroll + highlight)
- `src/routes/books.$bookId.tsx` (Tabs: Chapters / Quotes; lift selected chapter + jumpToMessageId state across panes)

## Notes

- No new auth/roles needed; all new tables piggy-back on existing `is_book_member` policies.
- Realtime subscriptions added for `chapter_message_context` (filtered by book) so the Context list stays live.