import type { FetchResult } from "../types.js";
import { fetchAsMarkdownRace } from "./fetcher.js";
import { tryFetch } from "./http/try-fetch.js";
import { looksLikeHtml } from "../utils/html-to-md.js";
import { normalizeHref, stripTags } from "../utils/html/links.js";

/**
 * How long a fan-out keeps waiting for more pages once the first one landed.
 * Waiting for every page let one slow Jina render (up to 25 s) hold back
 * pages that were ready in under a second.
 */
export const PAGE_GRACE_MS = 750;

export async function fetchFirstSuccessful(
  urls: string[],
  minLength = 300,
): Promise<FetchResult | null> {
  if (urls.length === 0) return null;

  try {
    return await Promise.any(
      urls.map(async (url) => {
        const content = await fetchAsMarkdownRace(url);
        if (content && content.length >= minLength) {
          return { content, url, sourceType: "deep-fetch" as const };
        }
        throw new Error("no content");
      }),
    );
  } catch {
    return null;
  }
}

/** Fulfilled values in input order, collected until every promise settled or `graceMs` after the first fulfilled. */
export function settleWithGrace<T>(promises: Array<Promise<T>>, graceMs: number): Promise<T[]> {
  const values = new Map<number, T>();
  return new Promise((resolve) => {
    let pending = promises.length;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (): void => {
      clearTimeout(timer);
      resolve([...values.entries()].sort(([a], [b]) => a - b).map(([, v]) => v));
    };
    if (pending === 0) return finish();
    promises.forEach((p, i) => {
      p.then(
        (v) => {
          values.set(i, v);
          timer ??= setTimeout(finish, graceMs);
        },
        () => {},
      ).finally(() => {
        if (--pending === 0) finish();
      });
    });
  });
}

export async function fetchMultiplePages(
  urls: string[],
  maxPages: number,
): Promise<Array<{ content: string; url: string }>> {
  const batch = urls.slice(0, maxPages);
  return settleWithGrace(
    batch.map(async (url) => {
      const content = await fetchAsMarkdownRace(url);
      if (content && content.length >= 300) {
        return { content, url };
      }
      throw new Error("no content");
    }),
    PAGE_GRACE_MS,
  );
}

// Bounded runs keep an unclosed <a> from scanning the rest of the page.
const ANCHOR = /<a\s[^>]{0,2000}?href="([^"]+)"[^>]{0,2000}>([\s\S]{0,2000}?)<\/a>/gi;

/**
 * Same-origin links of the HTML page at `url`, relative hrefs resolved, the page
 * itself left out. The markdown conversion drops the sidebar, and with it the
 * only links to sibling pages (tailwindcss.com/docs/theme, Spring's actuator/endpoints.html).
 */
export async function pageNavLinks(url: string): Promise<Array<{ url: string; text: string }>> {
  const html = await tryFetch(url, 0);
  if (!html || !looksLikeHtml(html)) return [];
  const page = new URL(url);
  const seen = new Set([page.href.replace(/#.*$/, "")]);
  const links: Array<{ url: string; text: string }> = [];
  for (const [, href = "", inner = ""] of html.matchAll(ANCHOR)) {
    let target: URL;
    try { target = new URL(normalizeHref(href), page); } catch { continue; }
    target.hash = "";
    const text = stripTags(inner).replace(/\s+/g, " ").trim();
    if (target.origin !== page.origin || !text || seen.has(target.href)) continue;
    seen.add(target.href);
    links.push({ url: target.href, text });
  }
  return links;
}

function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return hash;
}

// Code fences span blank lines: rejoin their pieces so a code block dedups whole
// or not at all. Dropping one repeated piece unbalanced every fence after it.
function blocks(content: string): string[] {
  const out: string[] = [];
  let open = false;
  for (const para of content.split(/\n{2,}/)) {
    if (open) out[out.length - 1] += `\n\n${para}`;
    else out.push(para);
    if ((para.match(/^[ \t]*(?:```|~~~)/gm) ?? []).length % 2 === 1) open = !open;
  }
  return out;
}

export function assemblePages(
  pages: Array<{ content: string; url: string }>,
): string {
  const seenHashes = new Set<number>();
  return pages
    .map((p) => {
      const paras = blocks(p.content);
      const unique = paras.filter((para) => {
        if (para.length < 50) return true;
        const hash = simpleHash(para.trim());
        if (seenHashes.has(hash)) return false;
        seenHashes.add(hash);
        return true;
      });
      return `## Source: ${p.url}\n\n${unique.join("\n\n")}`;
    })
    .join("\n\n---\n\n");
}
