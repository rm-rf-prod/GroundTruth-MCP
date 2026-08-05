import { fetchAsMarkdownRace } from "../fetcher.js";
import { tokenize, expandTopicTokens } from "../../utils/extract.js";

/** Fetch multiple URLs in parallel — return the one with the best quality content.
 *  Uses fetchAsMarkdownRace (direct HTML extraction + Jina) for each URL,
 *  so we're not solely dependent on Jina Reader.
 */
export async function raceUrls(
  urls: string[],
  topic = "",
): Promise<{ content: string; url: string; extraUrls: string[] } | null> {
  if (urls.length === 0) return null;

  const results = await Promise.allSettled(
    urls.map(async (url) => {
      const raw = await fetchAsMarkdownRace(url);
      if (raw && raw.length > 200) return { content: raw, url };
      throw new Error("no content");
    }),
  );

  const hits: Array<{ content: string; url: string }> = [];
  for (const result of results) {
    if (result.status === "fulfilled") {
      hits.push(result.value);
    }
  }

  if (hits.length === 0) return null;
  if (hits.length === 1) return { ...hits[0]!, extraUrls: [] };

  // Merge the top pages: topic relevance dominates, content quality (headings,
  // code blocks, length) breaks ties. Quality alone let the vitest SNAPSHOT
  // guide outrank the MOCKING guide for a "mocking" query — a longer page is
  // not a more on-topic page. Downstream BM25 extraction trims the merged
  // corpus back to the token budget.
  const topicTokens = expandTopicTokens(tokenize(topic));
  const topicScore = (h: { content: string; url: string }): number => {
    if (topicTokens.length === 0) return 0;
    const contentLower = h.content.slice(0, 20_000).toLowerCase();
    const urlLower = h.url.toLowerCase();
    let score = 0;
    for (const t of topicTokens) {
      if (urlLower.includes(t)) score += 20;
      score += Math.min(contentLower.split(t).length - 1, 10);
    }
    return score;
  };
  const ranked = [...hits].sort(
    (a, b) =>
      topicScore(b) - topicScore(a) ||
      scoreContentQuality(b.content) - scoreContentQuality(a.content),
  );
  const top = ranked.slice(0, 3);
  // Cap each source before merging — three unbounded pages would make the
  // downstream sanitize + BM25 pass scan megabytes for a few-KB output.
  const MAX_CHARS_PER_SOURCE = 80_000;
  const merged = top
    .map((h) => {
      let body = h.content.slice(0, MAX_CHARS_PER_SOURCE);
      // Balance fences per source — one truncated page must not leave the
      // section parser "inside a fence" for every source merged after it.
      for (const fence of ["```", "~~~"]) {
        if ((body.split(fence).length - 1) % 2 === 1) body += `\n${fence}`;
      }
      return `## Source: ${h.url}\n\n${body}`;
    })
    .join("\n\n---\n\n");
  return {
    content: merged,
    url: top[0]!.url,
    extraUrls: top.slice(1).map((h) => h.url),
  };
}

function scoreContentQuality(content: string): number {
  const headings = (content.match(/^#{1,4}\s+.+$/gm) ?? []).length;
  const codeBlocks = (content.match(/```/g) ?? []).length / 2;
  const len = content.length;
  let score = 0;
  score += Math.min(headings, 10) * 3;
  score += Math.min(codeBlocks, 5) * 5;
  if (len > 500) score += 5;
  if (len > 1000) score += 5;
  if (len > 3000) score += 5;
  if (len > 10000) score += 3;
  return score;
}
