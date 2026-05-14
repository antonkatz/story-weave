
## Goal

On the landing page (`/`), add a "Turn a podcast into a book" widget. User pastes a podcast URL (Apple, Spotify, or RSS), picks up to 5 episodes (combined ≤ 3 hours), clicks **Create book**. Behind the scenes we create a book, transcribe + diarize each episode, run the Structure agent and auto-accept every suggestion, then run the Quote agent and auto-accept everything. When done, we navigate the user into the finished book.

## UX

```text
┌────────────────────────────────────────────────────┐
│  Turn a podcast into a book                        │
│  ┌──────────────────────────────────────┐ [Fetch] │
│  │ https://podcasts.apple.com/...       │         │
│  └──────────────────────────────────────┘         │
│                                                    │
│  Show: <Podcast title> — <N episodes>             │
│  ┌────────────────────────────────────────────┐   │
│  │ ☐ Ep 142 — Title here              52:14  │   │
│  │ ☑ Ep 141 — Another title          1:08:02│   │
│  │ ☐ Ep 140 — ...                     44:31  │   │
│  └────────────────────────────────────────────┘   │
│  Selected: 2 / 5   ·   1h 52m / 3h 00m            │
│  [ Create book ]                                   │
└────────────────────────────────────────────────────┘
```

Selecting an episode that would push the total past 3h or count past 5 is disabled with a tooltip. After clicking **Create book** the widget swaps to a progress panel:

```text
Creating "<book title>"…
  ✓ Episode 1 — transcribed (12 speakers detected)
  ⟳ Episode 2 — transcribing…
  · Episode 3 — queued
  · Structure agent — pending
  · Quote agent — pending
```

When all rows hit ✓ we redirect to `/books/$bookId`.

If the user is signed out, clicking **Create book** triggers the existing auth flow first; the in-progress selection is preserved (URL params) and resumed after sign-in.

## Podcast resolution

One server function `resolvePodcast({ url })` returns `{ podcast: { title, author, artworkUrl }, episodes: [{ guid, title, durationSec, publishedAt, audioUrl }] }`.

Source detection:
- **RSS** (`http(s)://*.xml` or content-type `application/rss+xml` / `application/atom+xml`) → fetch + parse.
- **Apple Podcasts** (`podcasts.apple.com/.../id<NUM>`) → extract numeric id, call `https://itunes.apple.com/lookup?id=<id>&entity=podcast` → grab `feedUrl` → parse that RSS feed.
- **Spotify** (`open.spotify.com/show/...` or `episode/...`) → Spotify's web pages don't expose direct mp3 URLs and the API requires OAuth. v1 behaviour: show an inline error "Spotify isn't supported yet — paste the show's RSS feed or Apple Podcasts link instead." (Document this clearly in the input help text. Adding Spotify properly later means wiring the Spotify Web API + a fallback like Listen Notes; out of scope here.)

RSS parsing: pull `<item>` nodes, take `<title>`, `<guid>`, `<pubDate>`, `<itunes:duration>` (or compute from `<enclosure length>` + bitrate as a fallback), and `<enclosure url>`. Episodes returned newest-first. Cap to the first 50 to keep payload small.

## Pipeline

Because each Deepgram call for a long episode can take minutes and we want to stream progress to the UI, we orchestrate with a job table + a polling worker, not one giant request.

New tables:

```text
podcast_imports
  id, user_id, status (pending|running|done|error), error,
  source_url, podcast_title, book_id (nullable until created),
  created_at, updated_at

podcast_import_episodes
  id, import_id, position,
  episode_title, audio_url, duration_sec,
  status (queued|downloading|transcribing|done|error), error,
  source_message_id (nullable, the container voice message),
  created_at, updated_at
```

RLS: row-owner = `user_id` (members of the resulting book also see episode rows via book_id).

Server function `startPodcastImport({ source_url, episodes: [{title, audio_url, duration_sec}], book_title })`:
1. Insert `books` row owned by current user (title from podcast).
2. Insert `podcast_imports` (status=pending) and one `podcast_import_episodes` per selection.
3. Return `{ importId, bookId }` immediately — the client navigates to a progress view (or stays on the widget) and subscribes via Supabase realtime to `podcast_import_episodes` for live status.

Worker route `POST /api/public/podcast-import-tick` (called by `pg_cron` every 30s, authed with the anon `apikey` header):
- Pick the next `podcast_import_episodes` row in (`queued`, `downloading`, `transcribing`) that's stale or new, lock it via `update ... status=...` returning the row.
- For `queued`: stream the audio from `audio_url` into the `voice-messages` bucket at `<bookId>/<episodeId>.mp3`, insert a container `messages` row (`kind=voice`, `audio_path`, `body` = episode title), set `source_message_id`, mark `transcribing`, then invoke the existing `transcribe-voice` edge function with `{ messageId, audioPath }`. (The existing function already does diarization, turn-splitting, and `book_speakers` upserts.)
- When all episodes for an import reach `done`, kick off `run-agents` for `structure`, then auto-approve every resulting `suggested_edits` row for that book by reusing the same approval code path used in `SuggestedEdits.tsx` (extracted into a shared `applyEdit(edit)` helper in `src/lib/edits.ts`). Then call `run-agents` for `quotation` and auto-approve again. Mark `podcast_imports.status='done'`.

Auto-approval path: refactor the per-action apply logic out of `SuggestedEdits.tsx` into `src/lib/edits.server.ts` (server-only helper used by the worker) plus the existing client UI that already drives manual approvals — same SQL effects, no behavioural drift.

A single `pg_cron` schedule runs the tick every 30s; the worker processes one episode per tick, so a 5-episode import is fully done in ~(transcription time + agent time) minutes. The client's realtime subscription on `podcast_import_episodes` and `suggested_edits` shows live progress.

## File layout

- `src/components/landing/PodcastImporter.tsx` — the widget (URL field, episode list, selection limits, "Create book" button, embedded progress panel).
- `src/lib/podcast.functions.ts` — `resolvePodcast`, `startPodcastImport` (createServerFn).
- `src/lib/podcast.server.ts` — RSS parser, Apple lookup, audio streaming-to-storage helpers.
- `src/lib/edits.server.ts` — shared `applyEdit(supabaseAdmin, edit)` extracted from `SuggestedEdits.tsx`.
- `src/routes/api/public/podcast-import-tick.ts` — worker endpoint.
- `src/routes/index.tsx` — mount `<PodcastImporter />` above the existing feature grid.
- DB migration: `podcast_imports`, `podcast_import_episodes`, RLS, realtime publication, pg_cron schedule (every 30s) hitting the worker.

## Constraints & validation

- Server-side cap: reject `startPodcastImport` if `episodes.length > 5` or `sum(duration_sec) > 10800`.
- Reject non-https `audio_url`. Stream with a max byte cap (e.g. 500 MB per episode) to avoid runaway downloads.
- Storage bucket `voice-messages` already exists; episode files go in `<bookId>/` so they're cleaned up if the book is deleted (existing pattern).
- The widget is usable signed-out for the resolution step, but `Create book` requires auth — same pattern as the rest of the app.

## Out of scope (v1)

- Spotify resolution (needs OAuth + 3rd party).
- Re-running diarization across episodes to merge identical speakers (each episode gets its own `book_speakers` rows; user merges by renaming).
- Custom chapter mapping per episode (Structure agent decides).
- Letting the user tweak which agents auto-run (always Structure → Quote in this flow).
- Resumable downloads / retries beyond a single retry on transient failures.
