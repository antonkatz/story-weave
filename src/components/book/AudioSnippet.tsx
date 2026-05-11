import { useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";

type Props = {
  audioPath: string;
  startSec?: number | null;
  endSec?: number | null;
  label?: string;
  className?: string;
};

const urlCache = new Map<string, { url: string; expires: number }>();

async function getSignedUrl(path: string): Promise<string | null> {
  const cached = urlCache.get(path);
  if (cached && cached.expires > Date.now() + 60_000) return cached.url;
  const { data } = await supabase.storage
    .from("voice-messages")
    .createSignedUrl(path, 60 * 60);
  if (!data) return null;
  urlCache.set(path, { url: data.signedUrl, expires: Date.now() + 55 * 60_000 });
  return data.signedUrl;
}

export function AudioSnippet({ audioPath, startSec, endSec, label, className }: Props) {
  const [url, setUrl] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    let active = true;
    getSignedUrl(audioPath).then((u) => {
      if (active) setUrl(u);
    });
    return () => {
      active = false;
    };
  }, [audioPath]);

  const duration = startSec != null && endSec != null ? Math.max(0, endSec - startSec) : null;

  const toggle = async () => {
    const a = audioRef.current;
    if (!a || !url) return;
    if (playing) {
      a.pause();
      setPlaying(false);
      return;
    }
    if (startSec != null) {
      try {
        a.currentTime = startSec;
      } catch (_) {
        // no-op: setting currentTime can throw before metadata loads
      }
    }
    try {
      await a.play();
      setPlaying(true);
    } catch (e) {
      console.error("audio play failed", e);
    }
  };

  const onTimeUpdate = () => {
    const a = audioRef.current;
    if (!a) return;
    if (endSec != null && a.currentTime >= endSec) {
      a.pause();
      setPlaying(false);
    }
  };

  return (
    <div className={`flex items-center gap-2 ${className ?? ""}`}>
      <Button
        size="icon"
        variant="secondary"
        className="h-7 w-7 flex-none rounded-full"
        onClick={toggle}
        disabled={!url}
        aria-label={playing ? "Pause" : "Play"}
        type="button"
      >
        {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
      </Button>
      <span className="text-[10px] tabular-nums text-muted-foreground">
        {duration != null ? `0:${Math.max(1, Math.round(duration)).toString().padStart(2, "0")}` : ""}
      </span>
      {label && <span className="truncate text-xs text-muted-foreground">{label}</span>}
      {/* Hidden audio element — same signed URL is reused for slice playback */}
      <audio
        ref={audioRef}
        src={url ?? undefined}
        preload="metadata"
        onTimeUpdate={onTimeUpdate}
        onEnded={() => setPlaying(false)}
        onPause={() => setPlaying(false)}
      />
    </div>
  );
}
