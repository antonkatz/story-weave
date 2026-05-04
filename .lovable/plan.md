## 1. Quotes show authorship in export

`renderBookHtml` / `BookReader` already render `q.author_name`, but `src/routes/books.$bookId_.read.tsx` likely loads quotes without joining `profiles.display_name`. Update that loader to join `speaker_id → profiles.display_name` and pass `author_name` into `ReaderQuote`. Same check for `/join/$token` (uses `invite_book_content` RPC which already returns `author_name`).

## 2. "Made by HFX Ai Guy" footer on all pages

Currently `HfxBanner` only renders on `/books`. Move it into `src/routes/__root.tsx`'s `RootShell` so every page shows it (rendered below `<Outlet />` inside a `<footer>` wrapper, with bottom margin). Remove the duplicated mount from `books.index.tsx`. Keep it hidden on `auth` if it would crash (it uses `useAuth` — already safe since auth provider wraps everything).

## 3. Feedback email goes to two recipients

In `src/routes/api/contact-feedback.ts`, change `to: ["anton@hfxaiguy.com"]` to `to: ["anton@hfxaiguy.com", "antonkats@gmail.com"]`.

## 4. New "Splitter" agent

Add a 4th agent kind `splitter` to:
- `app_role`-style enum used by `agent_prompts_global` / `book_agent_prompts` / `message_agent_analysis` / `suggested_edits.agent` (DB migration to extend the enum).
- `supabase/functions/run-agents/index.ts`: new tool `splitter_actions` with action `split_message` (`{ source_message_id, parts: [{ speaker_label, text }] }`). System prompt detects subtitle-like content (timestamps, "Speaker A:" patterns) and otherwise splits long messages by topical breaks. Inserts as `suggested_edits` for user approval.
- Approval handler in `SuggestedEdits.tsx`: replaces original message with N new messages (insert new rows; soft-delete original by deleting it — author owns it via RLS only if it's theirs; otherwise show error). Speaker label stored in message body prefix when no matching profile found.
- Conversation UI: add Splitter button next to Structure/Quotation/Writing.
- Seed default global prompt for `splitter`.

## 5. Run agent processes all prior unanalyzed messages in 5000-char blocks

In `run-agents` (non-focused mode, when `messageId` is supplied via the per-message button OR when run on whole-book): if any messages exist that haven't been analyzed by this agent (`run_count = 0`), batch them into chunks where the cumulative `body/transcript` length ≤ 5000 chars. Run the model once per chunk, accumulate `actions`, then mark all included message ids analyzed. Today the per-message button only sends one message; change `Conversation.runAgentOnMessage` to instead invoke the agent in "catch-up" mode (no `messageId`) when there are unprocessed earlier messages, so the new batching kicks in.

## 6. Section suggestions show chapter; auto-create chapter on approve

`SuggestedEdits` `EditCard` for `add_section`:
- Resolve chapter name by looking up `payload.chapter_id` in current chapters list. If missing, look for a sibling pending `add_chapter` whose `payload.title` matches `payload.chapter_title_hint` (new field the agent emits) — show "Will create: <title>".
- On approve: if `chapter_id` doesn't resolve to an existing chapter, call new helper that first inserts a chapter with `{ title, synopsis, theme }` from the hint payload (agent must include synopsis + theme; update agent prompt + tool schema to require `chapter_title_hint`, `chapter_synopsis_hint`, `chapter_theme_hint` whenever it emits an add_section without a real `chapter_id`), then proceeds with section insert.
- Pass new chapter info through in the agent: in `run-agents`, when emitting `add_section` for a not-yet-existent chapter, attach `chapter_title_hint` / `chapter_synopsis_hint` / `chapter_theme_hint` (model fills these). Tool schema updated.

## 7. Action history in left sidebar (≥30% height)

In `src/routes/books.$bookId.tsx`, add a new component `ActionHistory` rendered in the left section (below `Tabs` content area). Use a vertical split: chapters/quotes panel on top (`flex-1`), history panel on bottom (`min-h-[30%]`, scrollable).

`ActionHistory` queries `suggested_edits` with `status in ('approved','rejected')` ordered by `resolved_at desc`, shows summary + agent badge + status icon + time. Realtime subscribe to updates.

## 8. Drop `set_chapter_synopsis`; sort chapter suggestions first

- Remove `set_chapter_synopsis` from agent tool enum and applier switch.
- Update structure agent system prompt: synopsis is set only inside `add_chapter`, never afterwards.
- In `SuggestedEdits` rendering: within each agent group, sort actions so `add_chapter` comes first, then `add_section`, then everything else. Apply this in the existing per-agent `list` before mapping.

## Files touched

- `src/routes/__root.tsx` (footer)
- `src/routes/books.index.tsx` (remove duplicate footer)
- `src/routes/books.$bookId.tsx` (left-sidebar layout + ActionHistory)
- `src/components/book/ActionHistory.tsx` (new)
- `src/components/book/Conversation.tsx` (splitter button, batch invocation)
- `src/components/book/SuggestedEdits.tsx` (sort, chapter hint display, auto-create-chapter, splitter approval)
- `src/routes/api/contact-feedback.ts` (CC)
- `src/routes/books.$bookId_.read.tsx` (load author_name for quotes)
- `supabase/functions/run-agents/index.ts` (splitter, batching, hints, drop synopsis action)
- New migration: extend `agent` enum with `splitter`; seed default `splitter` global prompt.

No DB schema changes besides the enum extension and a default prompt row.
