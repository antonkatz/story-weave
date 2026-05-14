import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { resolvePodcastUrl } from "./podcast.server";

const MAX_EPISODES = 5;
const MAX_TOTAL_SEC = 3 * 3600;

export const resolvePodcast = createServerFn({ method: "POST" })
  .inputValidator((input) => z.object({ url: z.string().min(1).max(2000) }).parse(input))
  .handler(async ({ data }) => {
    return await resolvePodcastUrl(data.url);
  });

export const startPodcastImport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input) =>
    z.object({
      sourceUrl: z.string().min(1).max(2000),
      podcastTitle: z.string().min(1).max(300),
      episodes: z.array(
        z.object({
          title: z.string().min(1).max(500),
          audioUrl: z.string().url().refine((u) => u.startsWith("https://"), "https only"),
          durationSec: z.number().int().min(0).max(6 * 3600),
        }),
      ).min(1).max(MAX_EPISODES),
    }).parse(input),
  )
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const totalSec = data.episodes.reduce((a, e) => a + e.durationSec, 0);
    if (totalSec > MAX_TOTAL_SEC) {
      throw new Error(`Combined duration ${Math.round(totalSec / 60)}m exceeds 3h cap`);
    }

    const { data: book, error: bookErr } = await supabase
      .from("books")
      .insert({ owner_id: userId, title: data.podcastTitle, description: `Imported from ${data.sourceUrl}` })
      .select("id")
      .single();
    if (bookErr || !book) throw bookErr ?? new Error("Could not create book");

    const { data: imp, error: impErr } = await supabase
      .from("podcast_imports")
      .insert({
        user_id: userId,
        source_url: data.sourceUrl,
        podcast_title: data.podcastTitle,
        book_id: book.id,
        status: "pending",
      })
      .select("id")
      .single();
    if (impErr || !imp) throw impErr ?? new Error("Could not create import job");

    const epRows = data.episodes.map((e, i) => ({
      import_id: imp.id,
      position: i,
      episode_title: e.title,
      audio_url: e.audioUrl,
      duration_sec: e.durationSec,
      status: "queued" as const,
    }));
    const { error: epErr } = await supabase.from("podcast_import_episodes").insert(epRows);
    if (epErr) throw epErr;

    return { importId: imp.id, bookId: book.id };
  });
