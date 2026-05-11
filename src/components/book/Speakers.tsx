import { useEffect, useState } from "react";
import { Users } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Input } from "@/components/ui/input";
import { AudioSnippet } from "@/components/book/AudioSnippet";

type Speaker = {
  id: string;
  speaker_key: string;
  display_name: string;
  sample_message_id: string | null;
  sample_start_sec: number | null;
  sample_end_sec: number | null;
};

type SampleAudio = { audioPath: string };

export function Speakers({ bookId }: { bookId: string }) {
  const [speakers, setSpeakers] = useState<Speaker[]>([]);
  const [audioPaths, setAudioPaths] = useState<Record<string, string>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const load = async () => {
    const { data } = await supabase
      .from("book_speakers")
      .select("id,speaker_key,display_name,sample_message_id,sample_start_sec,sample_end_sec")
      .eq("book_id", bookId)
      .order("created_at", { ascending: true });
    const rows = (data ?? []) as Speaker[];
    setSpeakers(rows);

    // Resolve audio_path for each sample message
    const msgIds = Array.from(
      new Set(rows.map((r) => r.sample_message_id).filter(Boolean) as string[]),
    );
    if (msgIds.length === 0) {
      setAudioPaths({});
      return;
    }
    const { data: msgs } = await supabase
      .from("messages")
      .select("id,audio_path")
      .in("id", msgIds);
    const map: Record<string, string> = {};
    for (const m of (msgs ?? []) as { id: string; audio_path: string | null }[]) {
      if (m.audio_path) map[m.id] = m.audio_path;
    }
    setAudioPaths(map);
  };

  useEffect(() => {
    load();
    const ch = supabase
      .channel(`speakers:${bookId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "book_speakers", filter: `book_id=eq.${bookId}` },
        () => load(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId]);

  const saveName = async (id: string, name: string) => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const current = speakers.find((s) => s.id === id);
    if (current && current.display_name === trimmed) return;
    const { error } = await supabase
      .from("book_speakers")
      .update({ display_name: trimmed })
      .eq("id", id);
    if (error) {
      toast.error("Could not rename speaker");
      return;
    }
  };

  return (
    <div className="flex h-full flex-col bg-paper/60">
      <div className="flex items-center gap-2 border-b border-border px-4 py-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <Users className="h-3.5 w-3.5" /> Speakers ({speakers.length})
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-2">
        {speakers.length === 0 ? (
          <p className="px-1 py-2 text-xs italic text-muted-foreground">
            No speakers yet. Upload an audio file with multiple voices and they'll appear here.
          </p>
        ) : (
          <ul className="space-y-1.5">
            {speakers.map((s) => {
              const path = s.sample_message_id ? audioPaths[s.sample_message_id] : undefined;
              const draft = drafts[s.id] ?? s.display_name;
              return (
                <li
                  key={s.id}
                  className="flex items-center gap-2 rounded border border-border bg-background/60 p-2"
                >
                  {path ? (
                    <AudioSnippet
                      audioPath={path}
                      startSec={s.sample_start_sec}
                      endSec={s.sample_end_sec}
                    />
                  ) : (
                    <span className="text-[10px] text-muted-foreground">no sample</span>
                  )}
                  <Input
                    value={draft}
                    onChange={(e) => setDrafts((d) => ({ ...d, [s.id]: e.target.value }))}
                    onBlur={() => saveName(s.id, draft)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.currentTarget.blur();
                      }
                    }}
                    className="h-7 flex-1 text-xs"
                    placeholder="Name this speaker"
                  />
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
