# Mobile-friendly book workspace

## Problem

`src/routes/books.$bookId.tsx` uses a fixed two-column grid (`1fr / 420px`) inside a `h-screen` shell. On phones everything is squished side-by-side with nested scroll regions, and the header buttons (Read/Export, Agents, Invite) overflow.

## Recommended approach

A **bottom tab bar on mobile** (mirroring native mobile patterns like Slack/Notion) is the best fit here because the workspace has 4 clear peer surfaces — **Chapters, Quotes, Conversation, Speakers/History**. It keeps each surface full-width and full-height (no squish), one tap away, with no hidden hamburger.

Desktop (≥ lg) keeps the current 2‑column layout untouched.

```text
mobile (<lg)                    desktop (≥lg)
┌──────────────────┐            ┌──────────┬─────────┐
│ header (compact) │            │          │ Convo   │
├──────────────────┤            │ Chapters │         │
│                  │            │  /Quotes ├─────────┤
│ active section   │            │          │ Speak/  │
│ (full-screen,    │            │          │ History │
│  scrollable)     │            └──────────┴─────────┘
│                  │
├──────────────────┤
│ 📖  💬  🗨  👥  │  ← bottom tab bar
└──────────────────┘
```

## Changes

Single file: `src/routes/books.$bookId.tsx`.

1. **Responsive shell.** Replace `flex h-screen flex-col` with `flex min-h-screen flex-col lg:h-screen`. On mobile the page becomes naturally scrollable; on desktop it stays fixed-height with internal scroll panes.

2. **Header.**
   - Collapse member avatars + secondary buttons into a single overflow menu (dropdown) on `<sm`. Keep `Invite` as the only visible primary action.
   - Allow the title row to wrap; shrink the "Book" eyebrow on mobile.

3. **Workspace.** Introduce a `view` state (`"chapters" | "quotes" | "conversation" | "speakers" | "history"`).
   - `<lg`: render only the active view in a full-width container with its own scroll. A fixed bottom tab bar (`fixed bottom-0 inset-x-0 border-t bg-paper`) with 4 icon+label buttons switches views. Add `pb-16` to the main scroll area so content isn't hidden behind the bar. Merge Speakers/History into one tab that internally still uses the existing Tabs.
   - `≥lg`: keep the existing 2-column grid; the bottom bar is hidden (`lg:hidden`). The existing `activeTab` (chapters/quotes) and Speakers/History tabs continue to drive the two columns.

4. **State wiring.** When a suggestion is applied on mobile (`handleApplied`), also switch `view` to `"chapters"` so the user sees the result. When `onJumpToChapter` fires from Quotes on mobile, switch `view` to `"chapters"`. When a message jump fires from Chapters on mobile, switch `view` to `"conversation"`.

5. **Inner panels.** No changes to `Chapters`, `Conversation`, `Speakers`, `QuotesBrowser`, `ActionHistory` — they already manage their own internal scroll, which now gets a real height to work with on mobile (`h-[calc(100vh-7rem-4rem)]` for active view, accounting for header + bottom bar).

## Out of scope

- Restyling the inner panels themselves (they already scroll fine when given height).
- Touch gestures / swipe between tabs.
- Landing page or other routes — only the book workspace is squished; other routes are already fine.

## Alternatives considered

- **Side drawer (hamburger):** hides primary navigation behind a tap, slower for the 4-peer surface model here.
- **Stacked accordion (all sections vertical, scroll through):** simple but loses the chat-style "conversation always reachable" feel and makes long chapter lists awkward to scroll past.
- **Top tab bar:** works, but bottom bar is more thumb-reachable on phones and is the standard mobile pattern for peer sections.
