import { topicLinkScorer } from "./links.js";
import { identifierStems } from "../utils/tokenize.js";
import { countTokenHits } from "../utils/evidence/match.js";
import { log } from "../utils/logger.js";
import { tryFetch } from "./http/try-fetch.js";

/**
 * Detect if content is a TOC/index page (list of links) rather than actual documentation.
 * These are common in llms.txt files that serve as directories rather than content.
 */
export function isIndexContent(content: string): boolean {
  const lines = content.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length < 5) return false;
  // Root-relative links count too — many llms.txt indexes (zustand, vitepress
  // sites) link their pages as [title](/path) rather than absolute URLs.
  const linkLines = lines.filter((l) => /^\s*-?\s*\[.+\]\((?:https?:\/\/|\/)[^)]+\)/.test(l));
  return linkLines.length / lines.length > 0.5;
}

interface IndexLink {
  url: string;
  text: string;
  score: number;
}

/**
 * Extract URLs from an index/TOC page and score them against a topic query.
 * Returns the best-matching URLs sorted by relevance, one per page: of the
 * framework copies of a guide, the one nearest `docsUrl` (else `baseUrl`).
 */
export function rankIndexLinks(content: string, topic: string, baseUrl?: string, docsUrl?: string): string[] {
  const links: IndexLink[] = [];
  const re = /\[([^\]]+)\]\((https?:\/\/[^)]+|\/[^)\s]+)\)/g;
  let match;
  while ((match = re.exec(content)) !== null) {
    if (match[1] && match[2]) {
      let url = match[2];
      if (url.startsWith("/")) {
        if (!baseUrl) continue;
        try {
          url = new URL(url, baseUrl).href;
        } catch {
          continue;
        }
      }
      links.push({ url, text: match[1].toLowerCase(), score: 0 });
    }
  }

  if (!topic || links.length === 0) return links.slice(0, 5).map((l) => l.url);

  // Synonym-expanded so "migration" queries match "Upgrade guide" links.
  const scoreLink = topicLinkScorer(topic);
  if (!scoreLink) return [];
  for (const link of links) link.score = scoreLink(link.text, link.url);
  // An identifier no link names (watchEffect) is usually documented on the page
  // its words name (Watchers). Titles only: URLs repeat the library's own name.
  if (!links.some((l) => l.score > 0)) {
    const stems = identifierStems(topic);
    for (const link of links) link.score = stems.filter((s) => countTokenHits(link.text, s) > 0).length;
  }

  // A score most links reach comes from a word in every URL ("query" in
  // tanstack.com/query/...): when some links score higher, only those count.
  const counts = new Map<number, number>();
  for (const l of links) counts.set(l.score, (counts.get(l.score) ?? 0) + 1);
  const common = [...counts].find(([, n]) => n > links.length / 2)?.[0] ?? 0;
  const floor = links.some((l) => l.score > common) ? common : 0;
  const ranked = links.filter((l) => l.score > floor).sort((a, b) => b.score - a.score);
  return pickDistinct(ranked, pathSegments(docsUrl ?? baseUrl ?? ""), 5);
}

/**
 * The top `limit` links, one per page. TanStack lists each guide once per
 * framework (react, solid, vue, ...): copies count once, as the equally scored
 * copy sharing the longest path prefix with `near`.
 */
function pickDistinct(ranked: IndexLink[], near: string[], limit: number): string[] {
  const picked: Array<{ url: string; score: number; segs: string[]; closeness: number }> = [];
  for (const { url, score } of ranked) {
    const segs = pathSegments(url);
    const closeness = sharedPrefix(segs, near);
    const i = picked.findIndex((p) => isCopy(p.segs, segs));
    const twin = picked[i];
    if (!twin) {
      if (picked.length < limit) picked.push({ url, score, segs, closeness });
    } else if (twin.score === score && closeness > twin.closeness) {
      picked[i] = { url, score, segs, closeness };
    }
  }
  return picked.map((p) => p.url);
}

/** index.md / README pages are named by their directory. */
const INDEX_PAGE = /^(?:index|readme)(?:\.\w+)?$/i;

/**
 * Same page under another framework, version or locale: at most one path
 * segment differs, and it is not the one naming the page (/kv/index.md and
 * /d1/index.md are two pages).
 */
function isCopy(a: string[], b: string[]): boolean {
  if (a.length === 0 || a.length !== b.length) return false;
  const differ = a.flatMap((seg, i) => (seg === b[i] ? [] : [i]));
  const page = INDEX_PAGE.test(a.at(-1) ?? "") ? a.length - 2 : a.length - 1;
  return differ.length === 0 || (differ.length === 1 && (differ[0] ?? page) < page);
}

/** Try llms.txt, then llms-full.txt, then Jina, then direct HTML */
/**
 * Pointer-style llms.txt files (e.g. nextjs.org/llms.txt) hold no index
 * themselves — they link to the real index one level down
 * (nextjs.org/docs/llms.txt). Follow same-host llms.txt links exactly one hop,
 * preferring the non-full variant (llms-full.txt can be megabytes). Without
 * this, index-link ranking sees two useless links and every downstream
 * traversal (docs, best-practices, snippets, search) comes up empty.
 */
export async function followNestedLlmsIndex(
  content: string,
  fetchedUrl: string,
  docsUrl?: string,
): Promise<{ content: string; url: string } | null> {
  if (content.length > 20_000) return null;
  const links = [...content.matchAll(/\]\((https?:\/\/[^)\s]+llms(?:-full)?\.txt)\)/g)]
    .map((m) => m[1])
    .filter((u): u is string => typeof u === "string");
  if (links.length === 0) return null;
  let host: string;
  try {
    host = new URL(fetchedUrl).hostname;
  } catch {
    return null;
  }
  const candidates = links.filter((u) => {
    try {
      return new URL(u).hostname === host && u !== fetchedUrl && !u.includes("llms-full");
    } catch {
      return false;
    }
  });
  // Multi-package indexes (svelte.dev lists docs/svelte before docs/kit) need
  // the one under the library's own docs path, not the first listed.
  const docsPath = docsUrl ? pathSegments(docsUrl) : [];
  let target: string | undefined;
  let bestShared = -1;
  for (const u of candidates) {
    const shared = sharedPrefix(pathSegments(u), docsPath);
    if (shared > bestShared) {
      target = u;
      bestShared = shared;
    }
  }
  if (!target) return null;
  const nested = await tryFetch(target);
  if (nested && nested.length > content.length) {
    log({ level: "info", msg: "fetchDocs.nested_llms_index", from: fetchedUrl, to: target });
    return { content: nested, url: target };
  }
  return null;
}

function pathSegments(url: string): string[] {
  try {
    return new URL(url).pathname.split("/").filter(Boolean);
  } catch {
    return [];
  }
}

function sharedPrefix(a: string[], b: string[]): number {
  let n = 0;
  while (n < a.length && n < b.length && a[n] === b[n]) n++;
  return n;
}
