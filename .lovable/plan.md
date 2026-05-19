## Problem

After picking an episode, the import is stuck on "Waiting to start…" forever. The episode row stays `status: queued, attempts: 0` and nothing ever runs.

Root cause: a `pg_cron` job runs every 30s and POSTs to
`https://project--…lovable.app/api/public/podcast-import-tick`, but that route file **does not exist** in the codebase (`src/routes/api/public/` is missing entirely — only `src/routes/api/contact-feedback.ts` is there). The published site returns the SPA fallback (HTTP 200, `1 row` in cron history) so the cron looks "succeeded" but no worker code ever runs. The worker logic itself lives in `supabase/functions/podcast-import-tick/index.ts` and has zero invocations.

## Fix

Create the missing TanStack server route at
`src/routes/api/public/podcast-import-tick.ts` and move the worker logic into it (the stack convention for this project — see `server-side-modern` knowledge: no Supabase Edge Functions for new logic).

### What the route does (port from the existing edge function)

1. POST handler, no auth required (under `/api/public/*`).
2. Uses `supabaseAdmin` from `@/integrations/supabase/client.server` (service-role, bypasses RLS).
3. Picks the oldest `podcast_import_episodes` row with `status = 'queued'`.
4. Marks it `downloading`, streams the audio URL into the existing `voice-messages` storage bucket at `${bookId}/${epId}.mp3` (500MB cap, same as today).
5. Inserts a `messages` row (`kind: 'voice'`, `audio_path: storagePath`) authored by the import's `user_id`.
6. Calls the existing `transcribe-voice` edge function via `fetch` to `${SUPABASE_URL}/functions/v1/transcribe-voice` with the service-role bearer (that function stays — it's the existing transcription pipeline).
7. Marks the episode `done`.
8. For every `podcast_imports` row in `pending`/`running`, if all its episodes are `done` and `agents_started_at` is null, set it `running` + stamp `agents_started_at`, then call `run-agents` (structure → auto-approve all pending `suggested_edits` → quotation → auto-approve again), then mark the import `done`.
9. Returns `{ ok: true, processed: <epId|null> }`.

The auto-approval helper (`applyEdit` + `autoApprovePending`) is ported verbatim — it already handles every `action_type` the agents emit and stays the source of truth.

### Why not just change cron to call the edge function?

The project's stated convention is "no Supabase Edge Functions for new server logic — use TanStack server routes." The cron URL (`project--{id}.lovable.app/api/public/…`) is already correct and stable; the missing piece is the route file. Keeping `transcribe-voice` and `run-agents` as edge functions is fine — those are pre-existing and inherited.

### Files

- **Create** `src/routes/api/public/podcast-import-tick.ts` — TanStack server route with the POST handler described above.
- **Delete** `supabase/functions/podcast-import-tick/index.ts` and its `[functions.podcast-import-tick]` block in `supabase/config.toml` (no longer needed; would just be dead code).

### Verification

1. After deploy, `cron.job_run_details` keeps succeeding (already does).
2. Within ~1 minute the existing stuck episode `28760fbd-…` transitions `queued → downloading → transcribing → done`.
3. Once all episodes are `done`, structure + quote agents fire, `suggested_edits` rows appear briefly then flip to `approved`, and chapters/quotes show up in the book UI.
4. No UI changes — the existing "Podcast import / Waiting to start…" panel will progress naturally as episode statuses change (it already polls).

## Out of scope

- Any UI changes
- Reworking `transcribe-voice` / `run-agents` / agent prompts
- Changing the cron schedule or auth model
