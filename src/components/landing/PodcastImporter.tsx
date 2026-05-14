import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, Mic } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth";
import { resolvePodcast, startPodcastImport } from "@/lib/podcast.functions";

const MAX_EPISODES = 5;
const MAX_TOTAL_SEC = 3 * 3600;

type Episode = { guid: string; title: string; durationSec: number; audioUrl: string };
type Resolved = { title: string; author: string; feedUrl: string; episodes: Episode[] };

function fmt(sec: number) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

export function PodcastImporter() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const resolveFn = useServerFn(resolvePodcast);
  const startFn = useServerFn(startPodcastImport);

  const [url, setUrl] = useState("");
  const [resolved, setResolved] = useState<Resolved | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [resolving, setResolving] = useState(false);
  const [starting, setStarting] = useState(false);

  const totalSec = resolved
    ? resolved.episodes.filter((e) => selected.has(e.guid)).reduce((a, e) => a + e.durationSec, 0)
    : 0;

  const fetchFeed = async () => {
    setResolving(true);
    try {
      const r = await resolveFn({ data: { url } });
      setResolved(r as Resolved);
      setSelected(new Set());
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not load feed");
    } finally {
      setResolving(false);
    }
  };

  const toggle = (ep: Episode) => {
    const next = new Set(selected);
    if (next.has(ep.guid)) {
      next.delete(ep.guid);
    } else {
      if (selected.size >= MAX_EPISODES) return;
      if (totalSec + ep.durationSec > MAX_TOTAL_SEC) return;
      next.add(ep.guid);
    }
    setSelected(next);
  };

  const create = async () => {
    if (!user) {
      navigate({ to: "/auth" });
      return;
    }
    if (!resolved || selected.size === 0) return;
    setStarting(true);
    try {
      const eps = resolved.episodes
        .filter((e) => selected.has(e.guid))
        .map((e) => ({ title: e.title, audioUrl: e.audioUrl, durationSec: e.durationSec }));
      const res = (await startFn({
        data: { sourceUrl: url, podcastTitle: resolved.title, episodes: eps },
      })) as { bookId: string };
      toast.success("Import started — transcription will run in the background");
      navigate({ to: "/books/$bookId", params: { bookId: res.bookId } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not start import");
    } finally {
      setStarting(false);
    }
  };

  return (
    <div className="rounded-2xl border border-border bg-paper p-6 shadow-page">
      <div className="flex items-center gap-2">
        <Mic className="h-5 w-5 text-primary" />
        <h2 className="font-serif text-xl font-semibold">Turn a podcast into a book</h2>
      </div>
      <p className="mt-1 text-sm text-muted-foreground">
        Paste an Apple Podcasts or RSS link, pick up to 5 episodes (max 3 hours total). We'll transcribe, diarize speakers, draft the structure and pull quotes — all automatically.
      </p>

      <div className="mt-4 flex gap-2">
        <Input
          placeholder="https://podcasts.apple.com/... or https://feeds.example.com/show.xml"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") fetchFeed(); }}
        />
        <Button onClick={fetchFeed} disabled={!url || resolving}>
          {resolving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Fetch"}
        </Button>
      </div>

      {resolved && (
        <div className="mt-5">
          <div className="mb-2 text-sm font-medium">{resolved.title}</div>
          <ul className="max-h-72 overflow-y-auto rounded border border-border divide-y divide-border">
            {resolved.episodes.slice(0, 50).map((ep) => {
              const isSel = selected.has(ep.guid);
              const wouldOverflow = !isSel && (selected.size >= MAX_EPISODES || totalSec + ep.durationSec > MAX_TOTAL_SEC);
              return (
                <li
                  key={ep.guid}
                  className={`flex items-center gap-3 px-3 py-2 text-sm ${wouldOverflow ? "opacity-50" : "cursor-pointer hover:bg-secondary/30"}`}
                  onClick={() => !wouldOverflow && toggle(ep)}
                >
                  <input type="checkbox" checked={isSel} readOnly disabled={wouldOverflow} />
                  <span className="flex-1 truncate">{ep.title}</span>
                  <span className="tabular-nums text-xs text-muted-foreground">{fmt(ep.durationSec)}</span>
                </li>
              );
            })}
          </ul>
          <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
            <span>Selected: {selected.size} / {MAX_EPISODES} · {fmt(totalSec)} / 3:00:00</span>
            <Button onClick={create} disabled={selected.size === 0 || starting}>
              {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Create book"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
