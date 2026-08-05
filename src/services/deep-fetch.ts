import type { FetchResult } from "../types.js";
import { fetchAsMarkdownRace, isIndexContent, rankIndexLinks, fetchSitemapUrls } from "./fetcher.js";
import { log } from "../utils/logger.js";
import {
  DEEP_FETCH_MAX_PAGES,
  DEEP_FETCH_RELEVANCE_THRESHOLD,
  DEEP_FETCH_TIMEOUT_MS,
} from "../constants.js";
import { scoreTopicRelevance, extractInternalLinks, rankLinksForTopic, buildTopicUrls } from "./links.js";

export { scoreTopicRelevance, extractInternalLinks, rankLinksForTopic, buildTopicUrls } from "./links.js";

async function fetchFirstSuccessful(
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

export async function fetchMultiplePages(
  urls: string[],
  maxPages: number,
): Promise<Array<{ content: string; url: string }>> {
  const batch = urls.slice(0, maxPages);
  const results = await Promise.allSettled(
    batch.map(async (url) => {
      const content = await fetchAsMarkdownRace(url);
      if (content && content.length >= 300) {
        return { content, url };
      }
      throw new Error("no content");
    }),
  );

  const pages: Array<{ content: string; url: string }> = [];
  for (const result of results) {
    if (result.status === "fulfilled") {
      pages.push(result.value);
    }
  }
  return pages;
}

function simpleHash(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return hash;
}

function assemblePages(
  pages: Array<{ content: string; url: string }>,
): string {
  const seenHashes = new Set<number>();
  return pages
    .map((p) => {
      const paras = p.content.split(/\n{2,}/);
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
    if (relevance >= DEEP_FETCH_RELEVANCE_THRESHOLD) return initialResult;
  }

  const pipeline = async (): Promise<FetchResult> => {
    // Real links from an index/TOC (llms.txt) beat fabricated slug URLs — try
    // them FIRST. Guessed slugs mostly 404 and used to burn the deep-fetch
    // time budget before the reliable path ever ran.
    if (isIndexContent(initialResult.content)) {
      const ranked = rankIndexLinks(initialResult.content, topic, initialResult.url || docsUrl);
      const pages = await fetchMultiplePages(ranked, maxPages);
      if (pages.length > 0) {
        return {
          content: assemblePages(pages),
          url: pages[0]?.url ?? "",
          sourceType: "deep-fetch",
        };
      }
    }

    const topicUrls = buildTopicUrls(docsUrl, topic, urlPatterns);
    if (topicUrls.length > 0) {
      const directHit = await fetchFirstSuccessful(topicUrls.slice(0, 6));
      if (directHit) return directHit;
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

  try {
    return await Promise.race([
      pipeline(),
      new Promise<FetchResult>((_, reject) =>
        setTimeout(() => reject(new Error("deep-fetch timeout")), DEEP_FETCH_TIMEOUT_MS),
      ),
    ]);
  } catch (err) {
    // Surface persistent timeouts so operators can see the deep-fetch budget is
    // too low or upstreams are slow; other errors fall through silently.
    if (err instanceof Error && err.message === "deep-fetch timeout") {
      log({ level: "warn", msg: "deep-fetch-timeout", topic, docsUrl, timeoutMs: DEEP_FETCH_TIMEOUT_MS });
    }
    return initialResult;
  }
}
