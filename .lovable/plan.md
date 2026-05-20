# Fix: Conversation realtime channels error on mobile

## Root cause

`src/components/book/Conversation.tsx` opens Supabase realtime channels with deterministic names (`conv-speakers:${bookId}`, `messages:${bookId}`, `analysis:${bookId}`, `import-status:${bookId}`, `import-episodes:${importId}`).

When the component unmounts and remounts quickly — which happens on the mobile layout every time the user switches the bottom-nav tab to/from "Chat", and also under React StrictMode in dev — the cleanup calls `supabase.removeChannel(ch)`, but that teardown is asynchronous. The next mount calls `supabase.channel("<same name>")` synchronously and gets back the **still-subscribed** channel instance. Calling `.on("postgres_changes", …)` on a channel that is already past `.subscribe()` throws:

> cannot add `postgres_changes` callbacks for realtime:conv-speakers:… after `subscribe()`

That bubbles up to the route's `errorComponent` and you see the generic "Something went wrong" screen.

The desktop layout keeps `<Conversation />` mounted, which is why it only reliably reproduces on the mobile view.

## Fix

Give every channel a unique suffix per effect run so a remount can never collide with a not-yet-torn-down channel. The simplest reliable suffix is `crypto.randomUUID()` (or `Math.random().toString(36).slice(2)`) generated inside the effect.

Edit `src/components/book/Conversation.tsx` in four places (the four `supabase.channel(...)` call sites) so each channel name includes a unique suffix:

```text
conv-speakers:${bookId}:${uid}
messages:${bookId}:${uid}
analysis:${bookId}:${uid}
import-status:${bookId}:${uid}
import-episodes:${importId}:${uid}
```

Where `uid` is generated at the top of each `useEffect` body. Nothing else about the subscriptions, filters, or cleanup needs to change.

## Out of scope

- No changes to the mobile layout, bottom-nav, or any other route/component.
- No change to how messages are fetched, rendered, or persisted.
- No change to the podcast-import worker.

## Verification

1. Open a book on a mobile viewport.
2. Tap **Chat** in the bottom nav, then tap **Chapters**, then tap **Chat** again a few times.
3. The error screen should no longer appear and realtime updates (new messages, transcripts arriving) should keep working across tab switches.
