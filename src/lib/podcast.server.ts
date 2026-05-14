// Server-only helpers for resolving podcast feeds and importing episodes.
// Apple Podcasts + RSS supported. Spotify is intentionally rejected upstream.

export type ResolvedEpisode = {
  guid: string;
  title: string;
  durationSec: number;
  publishedAt: string | null;
  audioUrl: string;
};

export type ResolvedPodcast = {
  title: string;
  author: string;
  artworkUrl: string | null;
  feedUrl: string;
  episodes: ResolvedEpisode[];
};

const APPLE_RE = /podcasts\.apple\.com\/.*\/id(\d+)/i;

export async function resolvePodcastUrl(input: string): Promise<ResolvedPodcast> {
  const url = input.trim();
  if (!url) throw new Error("Paste a podcast URL.");

  if (/open\.spotify\.com\//i.test(url)) {
    throw new Error(
      "Spotify links aren't supported yet — paste the show's RSS feed or Apple Podcasts link instead.",
    );
  }

  let feedUrl = url;
  const apple = url.match(APPLE_RE);
  if (apple) {
    const id = apple[1];
    const r = await fetch(`https://itunes.apple.com/lookup?id=${id}&entity=podcast`);
    if (!r.ok) throw new Error("Couldn't reach Apple Podcasts lookup.");
    const j = (await r.json()) as { results?: Array<{ feedUrl?: string }> };
    const found = j.results?.[0]?.feedUrl;
    if (!found) throw new Error("Apple lookup returned no RSS feed for this show.");
    feedUrl = found;
  }

  const xml = await fetchText(feedUrl);
  return parseRss(xml, feedUrl);
}

async function fetchText(url: string): Promise<string> {
  const r = await fetch(url, {
    headers: { "User-Agent": "Weave/1.0 (+podcast import)" },
    redirect: "follow",
  });
  if (!r.ok) throw new Error(`Feed fetch failed (${r.status})`);
  return await r.text();
}

function parseRss(xml: string, feedUrl: string): ResolvedPodcast {
  const channelTitle = pickTag(xml, "title") ?? "Untitled podcast";
  const author = pickTag(xml, "itunes:author") ?? pickTag(xml, "author") ?? "";
  const artworkUrl = matchAttr(xml, /<itunes:image[^>]*href="([^"]+)"/i)
    ?? pickTag(xml, "url"); // <image><url>...</url></image>

  const items = [...xml.matchAll(/<item\b[\s\S]*?<\/item>/gi)].map((m) => m[0]);
  const episodes: ResolvedEpisode[] = [];
  for (const item of items.slice(0, 80)) {
    const title = pickTag(item, "title") ?? "Untitled episode";
    const guid = pickTag(item, "guid") ?? matchAttr(item, /<enclosure[^>]*url="([^"]+)"/i) ?? title;
    const pubDate = pickTag(item, "pubDate");
    const durationRaw = pickTag(item, "itunes:duration") ?? "";
    const durationSec = parseDuration(durationRaw);
    const audioUrl = matchAttr(item, /<enclosure[^>]*url="([^"]+)"/i) ?? "";
    if (!audioUrl) continue;
    episodes.push({
      guid,
      title,
      durationSec,
      publishedAt: pubDate ?? null,
      audioUrl,
    });
  }
  return {
    title: channelTitle,
    author,
    artworkUrl: artworkUrl ?? null,
    feedUrl,
    episodes,
  };
}

function pickTag(xml: string, tag: string): string | null {
  const re = new RegExp(`<${escapeReg(tag)}\\b[^>]*>([\\s\\S]*?)</${escapeReg(tag)}>`, "i");
  const m = xml.match(re);
  if (!m) return null;
  return decodeXml(stripCdata(m[1])).trim();
}

function matchAttr(xml: string, re: RegExp): string | null {
  const m = xml.match(re);
  return m ? m[1] : null;
}

function stripCdata(s: string): string {
  return s.replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "");
}

function decodeXml(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function escapeReg(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseDuration(s: string): number {
  const trimmed = s.trim();
  if (!trimmed) return 0;
  // Either "HH:MM:SS", "MM:SS", or plain seconds.
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  const parts = trimmed.split(":").map(Number);
  if (parts.some((n) => Number.isNaN(n))) return 0;
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return 0;
}

// Streams a remote audio URL into Supabase storage. Caps at 500MB.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function streamAudioToStorage(client: any, audioUrl: string, storagePath: string): Promise<void> {
  const r = await fetch(audioUrl, {
    headers: { "User-Agent": "Weave/1.0" },
    redirect: "follow",
  });
  if (!r.ok || !r.body) throw new Error(`Audio fetch failed (${r.status})`);
  const MAX = 500 * 1024 * 1024;
  const reader = r.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) {
      total += value.byteLength;
      if (total > MAX) throw new Error("Episode exceeds 500MB cap");
      chunks.push(value);
    }
  }
  const blob = new Blob(chunks as BlobPart[], { type: r.headers.get("content-type") ?? "audio/mpeg" });
  const { error } = await client.storage.from("voice-messages").upload(storagePath, blob, {
    contentType: blob.type,
    upsert: true,
  });
  if (error) throw error;
}
