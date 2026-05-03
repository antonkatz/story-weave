## Literary Agents

Three AI agents collaborate to evolve the manuscript from the conversation. Each emits **granular, structured actions** that are saved as `suggested_edits` for human approval (existing flow). After every new message, the conversation panel surfaces a "Run agents on N new messages" button.

### 1. Agents

**Structure agent** — designs the book skeleton.
Actions: `add_chapter`, `rename_chapter`, `reorder_chapters`, `combine_chapters`, `set_chapter_synopsis`, `set_chapter_theme`, `add_section`, `rename_section`, `reorder_sections`, `remove_section`.

**Quotation agent** — pulls verbatim quotes from messages and assigns them to chapters/sections. Same quote can land in multiple chapters.
Actions: `create_quote` (text + source message), `assign_quote` (quote → chapter/section), `unassign_quote`, `move_quote`.

**Writing agent** — turns assigned quotes into prose for a specific section. Stays close to the verbatim quotes; mostly stitches and lightly connects.
Actions: `write_section` (chapter_id + section_id + prose), `append_to_section`, `replace_section`.

Each action becomes one row in `suggested_edits` with a typed payload. The Suggested Edits UI knows how to preview and apply each action type.

### 2. Data model (migration)

New columns / tables:

- `chapters.synopsis text`, `chapters.theme text`
- `chapter_sections` — `id, chapter_id, position, title, purpose, content text default ''`
- `quotes` — `id, book_id, source_message_id, text, speaker_id, created_at`
- `quote_placements` — `id, quote_id, chapter_id, section_id nullable, position` (many-to-many quote↔chapter/section)
- `messages.analyzed_at timestamptz` — set after agents process a message (so "N new messages" is computable)
- `agent_prompts_global` — `agent enum('structure','quotation','writing') primary key, prompt text, updated_at` (single row per agent, RLS: any authenticated read/write — or restrict to admins later)
- `book_agent_prompts` — `book_id, agent, prompt` override; null = inherit global
- `suggested_edits` extended: add `action_type text`, `payload jsonb` (keep existing `kind/proposed_*` for back-compat; new agent edits use `action_type`+`payload`)

RLS: all new book-scoped tables use `is_book_member(book_id, auth.uid())`. Global prompts readable by any authenticated user, writable by anyone for now (can lock to roles later).

### 3. Edge functions

- `run-agents` — input `{ bookId }`. Pulls messages where `analyzed_at IS NULL`, current chapters/sections/quotes, resolves prompts (book override ∪ global), runs the three agents sequentially via Lovable AI Gateway with **tool-calling** schemas matching each action, inserts resulting `suggested_edits` rows, marks messages analyzed. Returns `{ inserted, byAgent }`.
- Replaces (or supplements) `generate-edits` — keep it for back-compat; the new merged panel calls `run-agents`.

Each agent's tool schema declares its allowed actions as discriminated-union function tools so the model emits granular, validated payloads (e.g. writing agent must include `chapter_id` + `section_id`).

### 4. UI changes

**Merged Conversation panel** (`src/components/book/Conversation.tsx`)
- Becomes the single right-side panel (drop the two-tab Tabs in `books.$bookId.tsx`).
- Top: messages + composer (existing).
- Inline banner above composer: "N new messages since last run · [Run agents]" when `analyzed_at IS NULL` count > 0.
- Below: collapsible "Suggested edits" section showing pending agent proposals grouped by agent (Structure / Quotation / Writing), each with Approve/Reject. Reuses `Edits.tsx` logic, extended for new `action_type`s.

**Chapters UI** (`src/components/book/Chapters.tsx`)
- Show `synopsis` and `theme` under chapter title (editable).
- Render sections list per chapter with `title` + `purpose`; section content shown inline.
- Show quotes attached to a chapter/section in a sidebar strip (small cards with source author + jump-to-message).

**Per-book settings**
- New "Agents" button in the book header → dialog with three tabs (Structure / Quotation / Writing). Each shows the effective prompt (with "Inherited from global" badge) and an editor to override; "Reset to global" button.

**Global settings page** (`/settings/agents`)
- New top-level route. Same three-tab editor that writes `agent_prompts_global`.
- Add "Settings" link in `AppHeader`.

### 5. Action → apply mapping (Approve handler)

Each `action_type` has a small applier:
- `add_chapter` → insert chapter
- `set_chapter_synopsis` / `set_chapter_theme` → update chapter
- `add_section` / `rename_section` / `reorder_sections` → mutate `chapter_sections`
- `create_quote` → insert `quotes`
- `assign_quote` → insert `quote_placements`
- `write_section` / `append_to_section` / `replace_section` → update `chapter_sections.content`

Rejection just marks the edit `rejected` (existing behavior).

### 6. Files to add / change

- migration: tables + columns above
- `supabase/functions/run-agents/index.ts` (new)
- `src/routes/settings.agents.tsx` (new)
- `src/components/book/AgentSettingsDialog.tsx` (new, per-book)
- `src/components/book/Conversation.tsx` (merge edits in, add run-agents button)
- `src/components/book/Edits.tsx` (extend for new action_types, group by agent)
- `src/components/book/Chapters.tsx` (synopsis/theme/sections/quotes display & edit)
- `src/routes/books.$bookId.tsx` (drop Tabs, single right panel; add Agent Settings button)
- `src/components/AppHeader.tsx` (Settings link)

### 7. Open assumption (will proceed unless you object)

Default global prompts will be seeded by the migration with sensible starter text for each agent. You can edit them anytime in `/settings/agents`.
