import { tokenize, expandTopicTokens } from "../utils/extract.js";
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

/**
 * Extract URLs from an index/TOC page and score them against a topic query.
 * Returns the best-matching URLs sorted by relevance.
 */
export function rankIndexLinks(content: string, topic: string, baseUrl?: string): string[] {
  const links: Array<{ url: string; text: string; score: number }> = [];
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
  const queryWords = expandTopicTokens(tokenize(topic));

  for (const link of links) {
    const combined = link.text + " " + link.url.toLowerCase();
    for (const word of queryWords) {
      if (combined.includes(word)) link.score += 10;
    }
  }

  return links
    .filter((l) => l.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map((l) => l.url);
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
  const target = links.find((u) => {
    try {
      return new URL(u).hostname === host && u !== fetchedUrl && !u.includes("llms-full");
    } catch {
      return false;
    }
  });
  if (!target) return null;
  const nested = await tryFetch(target);
  if (nested && nested.length > content.length) {
    log({ level: "info", msg: "fetchDocs.nested_llms_index", from: fetchedUrl, to: target });
    return { content: nested, url: target };
  }
  return null;
}
