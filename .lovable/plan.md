## Goals

1. Use Deepgram speaker diarization on uploaded audio.
2. **Split each diarized recording into one message per speaker turn** so the conversation thread reads like a real back-and-forth, with each turn attributable to a speaker.
3. Add a "Speakers" panel where the user can name detected voices and play a short sample clip of each one.
4. Move Action History out of the bottom of the left reading area into a tab in the right sidebar (alongside Speakers).
5. **Remove OpenAI Whisper from the transcription path** — Deepgram is the only provider.

## UX

**Right sidebar** becomes a vertical split:
- Top ~62%: Conversation (unchanged).
- Bottom ~38%: tabbed panel — **Speakers** | **History**.

**Speakers tab**:

```text
┌──────────────────────────────────────┐
│ Speakers (3)                         │
├──────────────────────────────────────┤
│ ▶ 0:04  [Name this speaker____]  ✎  │
│ ▶ 0:03  Mom                       ✎  │
│ ▶ 0:05  Grandpa Joe               ✎  │
└──────────────────────────────────────┘
```

- ▶ plays a 3–6 s sample (longest contiguous utterance for that speaker).
- Text input names the speaker; saves on blur / Enter.
- New speakers appear automatically after each transcription.

**Conversation thread (turn-splitting)**:
When a diarized upload completes, instead of one big voice message we render **one bubble per speaker turn**, in chronological order, each labelled with the speaker name (e.g. "Speaker 1" until renamed, then live-updates to the chosen name). All turn-bubbles share the same source audio file but each plays only its own slice (start/end timestamps).

## Data model

New table `book_speakers`:

```text
book_speakers
  id              uuid pk
  book_id         uuid
  speaker_key     text          -- "<source_message_id>:<deepgram_index>", scoped per book
  display_name    text          -- defaults "Speaker N"
  sample_message_id uuid null   -- voice message containing the sample
  sample_start_sec  numeric null
  sample_end_sec    numeric null
  created_at, updated_at
  unique (book_id, speaker_key)
```

(Deepgram resets speaker indices per request, so we namespace the key by source message. Two recordings with the same person produce two `book_speakers` rows; the user merges them by giving them the same name — explicit cross-file voice matching is out of scope for v1.)

New columns on `messages`:

```text
speaker_id        uuid null     -- references book_speakers.id (per turn-bubble)
source_audio_message_id uuid null  -- the original "container" voice message this turn was split out of
audio_start_sec   numeric null
audio_end_sec     numeric null
diarization       jsonb null    -- only populated on the original container message
```

Per-turn bubbles:
- `kind = 'voice'`
- `audio_path` = same path as the source message (so the storage URL is reused)
- `audio_start_sec` / `audio_end_sec` = this turn's slice
- `transcript` = text spoken in that slice
- `speaker_id` = the corresponding `book_speakers` row
- `source_audio_message_id` = the container message id (so the UI can group turns and we can clean them up if the source is deleted)

The original "container" message keeps the full audio + full `diarization` jsonb but is hidden in the conversation feed (filtered out client-side) — it exists so we still have the canonical upload record and can re-split if needed.

RLS: same as `messages` — book members read/write.

## Server changes

`supabase/functions/transcribe-voice/index.ts`:

- **Delete the OpenAI Whisper code path entirely.** Single provider: Deepgram. Drop the `OPENAI_API_KEY` branch, the size-based router, and the HEAD probe (no longer needed).
- Call Deepgram with `?model=nova-2&smart_format=true&punctuate=true&diarize=true&utterances=true`.
- Use `results.utterances` (Deepgram already groups consecutive same-speaker words into utterances) and **merge consecutive utterances with the same `speaker`** into "turns" — separated when the speaker changes.
- For each unique speaker index, find the longest single contiguous utterance and remember `{ start, end }` as that speaker's sample.
- Upsert `book_speakers` rows (one per unique speaker index in this message), defaulting `display_name` to `Speaker N` and storing the sample pointer.
- Insert one new `messages` row per turn (kind=voice, same `audio_path`, `audio_start_sec`/`audio_end_sec`, transcript, `speaker_id`, `source_audio_message_id` = original message id, `author_id` = uploader).
- Update the original message: set `diarization` jsonb (full word/utterance data), leave `transcript` as the full concatenated transcript for record-keeping. The client filters out messages where `source_audio_message_id IS NULL` AND `diarization IS NOT NULL` from the conversation feed (they're "container" rows).

If `DEEPGRAM_API_KEY` is missing, fail loud with a clear error — there is no fallback anymore.

## Client changes

- `src/components/book/Conversation.tsx`:
  - Filter out container messages (`diarization != null && source_audio_message_id == null`) from the rendered list.
  - For turn bubbles (`source_audio_message_id != null`), show the speaker's `display_name` (joined from `book_speakers`) above the transcript, and render an `<audio>` that plays only the slice — set `currentTime = audio_start_sec` on play, pause when `currentTime >= audio_end_sec` via `timeupdate`. Reuse the existing signed-URL flow for `voice-messages`.
  - Subscribe to `book_speakers` realtime updates so renaming a speaker live-updates every bubble attributed to them.
- `src/components/book/Speakers.tsx` (new): list `book_speakers` for the book, rename inline (debounced update), play sample using the same slice-playback technique.
- `src/routes/books.$bookId.tsx`:
  - Remove the bottom `<ActionHistory>` block from inside the left `<section>`.
  - Right `<aside>` becomes flex column: `Conversation` (flex-1) + tabbed bottom panel (`h-[38%]`, `min-h-[260px]`) with `Speakers` and `History` tabs.

## Migration

Single SQL migration:
- create `book_speakers` table + RLS (`is_book_member` for select/insert/update; no delete v1)
- add `messages.speaker_id`, `messages.source_audio_message_id`, `messages.audio_start_sec`, `messages.audio_end_sec`, `messages.diarization`
- enable realtime on `book_speakers`
- index `messages(source_audio_message_id)` and `messages(speaker_id)`

## Out of scope

- Cross-file voice identity matching (user merges by naming).
- Linking `book_speakers` to `profiles` (auth users).
- Re-attributing existing `quotes.speaker_id` (still points at profiles).
- Re-running diarization on already-uploaded audio (only new uploads get split).
