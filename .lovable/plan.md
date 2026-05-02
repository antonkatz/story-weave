## The Collaborative Book Writing App

A warm, literary-feeling app where friends have free-flowing conversations (text or voice) and AI weaves those conversations into book chapters that the group approves together.

### Core flow

1. Sign in (email/password or Google)
2. See **My Books** — a shelf of your books, plus a button to start a new one
3. Open a book to find three workspaces side-by-side:
   - **Chapters** — the living manuscript
   - **Conversation** — group chat with text + voice messages, transcribed automatically
   - **Edits** — AI-drafted chapter changes pulled from the conversation, each with Approve / Reject
4. Invite co-authors by email or shareable link

---

### Screen 1 — My Books

- Header with app name and user menu (sign out)
- Grid of book cards: title, brief description, co-author avatars, last activity
- "New Book" card opens a small dialog (title + optional description)
- Empty state encourages creating the first book

### Screen 2 — Book Workspace

Two-column layout on desktop, tabs on mobile.

**Left column — Chapters**
- Ordered list of chapters (Introduction, Chapter 1, …)
- Click a chapter to open it in a reader/editor pane
- "Add chapter" button at the bottom
- Owner can rename, reorder, or delete chapters

**Right column — Conversation + Edits (tabbed)**

*Conversation tab*
- Chronological message thread with author avatar, name, timestamp
- Text input + send
- Microphone button: hold-to-record voice message; on release it uploads, plays back inline, and is auto-transcribed under the audio
- Each new transcript is fed to the AI in the background

*Edits tab*
- Cards of AI-suggested edits: target chapter, short summary ("Add a paragraph about Jane's childhood memory"), and a diff-style preview (old text → new text, or "new content")
- Approve (green check) applies the edit to the chapter; Reject (purple X) dismisses it
- Edits are timestamped and attributed ("from conversation on May 1")

**Top bar of the book**
- Book title (editable by owner)
- Co-author avatars
- **Invite** button → dialog with two tabs: "Email invite" (enter address, sends link) and "Share link" (copy a join URL; anyone signed in who opens it joins)

---

### AI behavior

- Voice messages are transcribed to text on upload
- Periodically (and on demand via a "Generate edits" button), the AI reads recent unprocessed conversation and proposes 1–5 chapter edits — either inserting new prose into an existing chapter or drafting a brand-new chapter
- Edits stay pending until a co-author approves or rejects them; approving rewrites the chapter content

---

### Visual design — Warm Literary

- Cream/parchment background (`#FBF7EF`), deep ink text (`#2A2118`)
- Accent: muted brick/burgundy for primary actions, soft sage for "approved" states, dusty plum for "edits"
- Headings in a serif (Playfair Display); body in a clean serif-friendly sans (Inter)
- Generous whitespace, soft shadows, rounded corners — feels like an open notebook
- Subtle paper texture on the book workspace background

---

### Technical notes

- **Backend:** Lovable Cloud (Supabase) with email/password + Google auth. A `profiles` table is created (display name, avatar) with an auto-create trigger on signup.
- **Tables:** `books`, `book_members` (with role: owner/co-author), `chapters` (ordered, content as text), `messages` (text or voice, with `audio_url` and `transcript`), `suggested_edits` (target_chapter, kind: insert/replace/new_chapter, proposed_content, status: pending/approved/rejected), `invites` (email, token, book_id, expires_at). Roles stored in a separate `book_members` table — never on profiles. RLS policies restrict every table to members of the relevant book.
- **Storage:** A private `voice-messages` bucket; signed URLs for playback; RLS policies tied to book membership.
- **Voice transcription:** ElevenLabs Scribe (batch). After upload, a server function transcribes the file and stores the transcript on the message row. Requires an `ELEVENLABS_API_KEY` secret — I'll prompt you to add it during build.
- **AI edits:** Lovable AI Gateway (default `google/gemini-3-flash-preview`) via a server function, using tool-calling to return structured edit suggestions written into `suggested_edits`.
- **Realtime:** Supabase Realtime subscriptions on `messages` and `suggested_edits` so co-authors see updates live.
- **Invites:** Email invites generate a token row; the invite link routes to `/join/$token` which adds the signed-in user to `book_members` and redirects to the book. "Share link" uses the same token mechanism with a longer expiry.
- **Routes:** `/` (landing/redirect), `/auth` (sign in/up), `/books` (my books), `/books/$bookId` (workspace), `/join/$token` (accept invite), `/reset-password`.

---

### Out of scope for v1 (can add later)

- Live voice rooms / real-time calls
- Exporting the finished book to PDF/EPUB
- Per-chapter commenting threads
- Granular permission roles beyond owner / co-author