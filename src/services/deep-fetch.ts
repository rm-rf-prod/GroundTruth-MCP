import type { FetchResult } from "../types.js";
import { isIndexContent, rankIndexLinks, fetchSitemapUrls } from "./fetcher.js";
import { log } from "../utils/logger.js";
import {
  DEEP_FETCH_MAX_PAGES,
  DEEP_FETCH_RELEVANCE_THRESHOLD,
  DEEP_FETCH_TIMEOUT_MS,
} from "../constants.js";
import { scoreTopicRelevance, hasTopicIdentifiers, extractInternalLinks, rankLinksForTopic, buildTopicUrls } from "./links.js";
import { fetchFirstSuccessful, fetchMultiplePages, assemblePages, pageNavLinks } from "./deep-fetch-pages.js";

export { scoreTopicRelevance, extractInternalLinks, rankLinksForTopic, buildTopicUrls } from "./links.js";
export { fetchMultiplePages } from "./deep-fetch-pages.js";

export function splitTopics(topic: string): string[] {
  const parts = topic.split(/\s+(?:and|&|\+|vs\.?|or)\s+/i).map((p) => p.trim()).filter(Boolean);
  if (parts.length <= 1) return [topic];
  return parts.filter((p) => p.length >= 3);
}

export async function deepFetchForTopic(
  initialResult: FetchResult,
  topic: string,
  docsUrl: string,
  urlPatterns?: string[],
  maxPages = DEEP_FETCH_MAX_PAGES,
  force = false,
): Promise<FetchResult> {
  if (!topic || topic.trim().length === 0) return initialResult;

  // force=true bypasses the cheap relevance early-exit. Used by the evidence
  // gate: scoreTopicRelevance accepts a single passing mention (per its test
  // contract), but when the FINAL extracted output fails the stricter
  // checkEvidence bar, tools re-run the pipeline here to hunt topic pages.
  if (!force) {
    const relevance = scoreTopicRelevance(initialResult.content, topic);
    // A page with "mock" and "module" but never "vi.mock" is a neighbour of the
    // answer, not the answer: identifiers must appear as written to stop here.
    if (relevance >= DEEP_FETCH_RELEVANCE_THRESHOLD && hasTopicIdentifiers(initialResult.content, topic)) {
      return initialResult;
    }
  }

  const pipeline = async (): Promise<FetchResult> => {
    // Real links from an index/TOC (llms.txt) beat fabricated slug URLs — try
    // them FIRST. Guessed slugs mostly 404 and used to burn the deep-fetch
    // time budget before the reliable path ever ran.
    if (isIndexContent(initialResult.content)) {
      const ranked = rankIndexLinks(initialResult.content, topic, initialResult.url || docsUrl, docsUrl);
      const pages = await fetchMultiplePages(ranked, maxPages);
      if (pages.length > 0) {
        return {
          content: assemblePages(pages),
          url: pages[0]?.url ?? "",
          sourceType: "deep-fetch",
        };
      }
    }

    const internalLinks = extractInternalLinks(initialResult.content, docsUrl);
    if (internalLinks.length > 0) {
      const ranked = rankLinksForTopic(internalLinks, topic);
      if (ranked.length > 0) {
        const pages = await fetchMultiplePages(
          ranked.map((l) => l.url),
          maxPages,
        );
        if (pages.length > 0) {
          return {
            content: assemblePages(pages),
            url: pages[0]?.url ?? "",
            sourceType: "deep-fetch",
          };
        }
      }
    }

    // An HTML page's sidebar, which its markdown no longer has. llms files and READMEs have none.
    const pageUrl = initialResult.url || docsUrl;
    if (!/^(?:llms|github)/.test(initialResult.sourceType) && /^https?:\/\//.test(pageUrl)) {
      const ranked = rankLinksForTopic(await pageNavLinks(pageUrl), topic);
      const pages = await fetchMultiplePages(ranked.map((l) => l.url), maxPages);
      if (pages.length > 0) {
        return { content: assemblePages(pages), url: pages[0]?.url ?? "", sourceType: "deep-fetch" };
      }
    }

    // Guessed slugs come after every real link source: they mostly 404, and
    // each miss used to spend the shared time budget before real links ran.
    const topicUrls = buildTopicUrls(docsUrl, topic, urlPatterns);
    if (topicUrls.length > 0) {
      const directHit = await fetchFirstSuccessful(topicUrls.slice(0, 6));
      if (directHit) return directHit;
    }

    const sitemapUrls = await fetchSitemapUrls(docsUrl);
    if (sitemapUrls.length > 0) {
      const sitemapLinks = sitemapUrls.map((url) => ({ url, text: url }));
      const ranked = rankLinksForTopic(sitemapLinks, topic);
      if (ranked.length > 0) {
        const pages = await fetchMultiplePages(
          ranked.map((l) => l.url),
          maxPages,
        );
        if (pages.length > 0) {
          return {
            content: assemblePages(pages),
            url: pages[0]?.url ?? "",
            sourceType: "deep-fetch",
          };
        }
      }
    }

    return initialResult;
  };

  // Cleared on every exit: a live 25 s timer kept one-shot CLI processes idle after the answer.
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      pipeline(),
      new Promise<FetchResult>((_, reject) => {
        timer = setTimeout(() => reject(new Error("deep-fetch timeout")), DEEP_FETCH_TIMEOUT_MS);
      }),
    ]);
  } catch (err) {
    // Surface persistent timeouts so operators can see the deep-fetch budget is
    // too low or upstreams are slow; other errors fall through silently.
    if (err instanceof Error && err.message === "deep-fetch timeout") {
      log({ level: "warn", msg: "deep-fetch-timeout", topic, docsUrl, timeoutMs: DEEP_FETCH_TIMEOUT_MS });
    }
    return initialResult;
  } finally {
    clearTimeout(timer);
  }
}
