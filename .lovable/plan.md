## Background

The 25 MB audio cap is enforced by OpenAI's Whisper API (`/v1/audio/transcriptions`). It's a hard limit per request — we can't raise it, only work around it by splitting larger files into <25 MB chunks, transcribing each, and concatenating the results.

## Approach

Raise the client-side limit and add server-side chunking in the `transcribe-voice` edge function. Audio splitting in a Deno Edge runtime can't use `ffmpeg` (no native binaries). Two viable options:

**Option A — Time-based chunking via ffmpeg.wasm** (heavy: ~25 MB wasm bundle, slow cold start, may hit edge function memory/CPU limits).

**Option B — Use a hosted transcription provider that accepts larger files**, e.g. Deepgram (no size limit on prerecorded), AssemblyAI (up to ~5 GB), or OpenAI's newer `gpt-4o-transcribe` (still 25 MB but supports streaming). Simplest swap: Deepgram.

**Option C — Naive byte-range chunking**. Doesn't work for compressed audio (webm/mp3/m4a) — chunks aren't independently decodable. Skip.

Recommended: **Option B with Deepgram** as the cleanest fix. Falls back to OpenAI for files <25 MB if no Deepgram key is set.

If you'd rather keep OpenAI only, we go with Option A (ffmpeg.wasm) and accept the cold-start cost + a ~100 MB practical ceiling.

## Changes

### 1. Client (`src/components/book/Conversation.tsx`)
- Raise the `25 * 1024 * 1024` guard to e.g. `200 * 1024 * 1024` (200 MB).
- Update toast copy to reflect new limit.

### 2. Edge function (`supabase/functions/transcribe-voice/index.ts`)
**If Option B (Deepgram):**
- Add `DEEPGRAM_API_KEY` secret.
- Route files >24 MB (or all files, if preferred) to Deepgram's `/v1/listen?model=nova-2&smart_format=true` endpoint, streaming the signed URL directly (no download needed — Deepgram fetches it).
- Keep OpenAI Whisper as fallback for small files / if Deepgram key missing.
- Map Deepgram response → `transcript` string (concatenate `results.channels[0].alternatives[0].transcript`).

**If Option A (ffmpeg.wasm):**
- Import `@ffmpeg/ffmpeg` via `npm:` specifier.
- Download audio, probe duration, split into N segments each ≤ ~20 MB target, re-encode each to a Whisper-supported format.
- Run Whisper on each chunk in sequence (or limited concurrency), concatenate transcripts with a space.
- Risk: edge function 150s wall-clock and ~256 MB RAM ceiling; large files may time out.

### 3. Optional UX
- Show "Transcribing… (long file, may take a minute)" placeholder for files >25 MB.

## Question for you

Which option do you want?

- **A**: ffmpeg.wasm chunking, stay on OpenAI Whisper. (~100 MB practical max, slower, no new secret.)
- **B**: Switch large files to Deepgram (or another provider). (Cleanest, needs one API key, ~no size cap.)
- **C**: Just raise the limit to e.g. 100 MB and let OpenAI reject anything over 25 MB (do nothing server-side). Bad UX, not recommended.
