import type { FetchResult } from "../types.js";
import { tokenize } from "../utils/extract.js";
import { fetchViaJina, isIndexContent, rankIndexLinks, fetchSitemapUrls } from "./fetcher.js";
import {
  DEEP_FETCH_MAX_PAGES,
  DEEP_FETCH_RELEVANCE_THRESHOLD,
  DEEP_FETCH_TIMEOUT_MS,
} from "../constants.js";

export function scoreTopicRelevance(content: string, topic: string): number {
  const topicTokens = tokenize(topic);
  if (topicTokens.length === 0) return 1;

  const prose = content
    .replace(/\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/https?:\/\/\S+/g, "")
    .toLowerCase();
  let found = 0;
  for (const token of topicTokens) {
    if (prose.includes(token)) found++;
  }
  return found / topicTokens.length;
}

export function extractInternalLinks(
  content: string,
  baseUrl: string,
): Array<{ url: string; text: string }> {
  let origin: string;
  try {
    origin = new URL(baseUrl).origin;
  } catch {
    return [];
  }

  const linkRegex = /\[([^\]]+)\]\((https?:\/\/[^)]+|\/[^)]+)\)/g;
  const seen = new Set<string>();
  const links: Array<{ url: string; text: string }> = [];
  let match;

  while ((match = linkRegex.exec(content)) !== null) {
    const text = match[1] ?? "";
    const rawUrl = match[2] ?? "";
    let resolved: string;
    try {
      resolved = new URL(rawUrl, baseUrl).href;
    } catch {
      continue;
    }

    if (!resolved.startsWith(origin)) continue;
    if (seen.has(resolved)) continue;
    seen.add(resolved);
    links.push({ url: resolved, text });
  }

  return links;
}

export function rankLinksForTopic(
  links: Array<{ url: string; text: string }>,
  topic: string,
): Array<{ url: string; text: string; score: number }> {
  const topicTokens = tokenize(topic);
  if (topicTokens.length === 0 || links.length === 0) return [];

  const scored = links.map((link) => {
    const urlSegments = link.url.toLowerCase().replace(/[^a-z0-9/]/g, " ");
    const combined = `${link.text.toLowerCase()} ${urlSegments}`;
    let score = 0;
    for (const token of topicTokens) {
      if (combined.includes(token)) score += 10;
    }
    return { ...link, score };
  });

  return scored
    .filter((l) => l.score > 0)
    .sort((a, b) => b.score - a.score);
}

export function buildTopicUrls(
  docsUrl: string,
  topic: string,
  urlPatterns?: string[],
): string[] {
  let origin: string;
  try {
    origin = new URL(docsUrl).origin;
  } catch {
    return [];
  }

  const hyphenSlug = topic
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9-]/g, "");
  const slashSlug = topic
    .toLowerCase()
    .replace(/\s+/g, "/")
    .replace(/[^a-z0-9/]/g, "");

  const defaultPatterns = [
    "/docs/{slug}",
    "/docs/guides/{slug}",
    "/docs/api/{slug}",
    "/reference/{slug}",
    "/guide/{slug}",
    "/learn/{slug}",
    "/tutorial/{slug}",
    "/docs/concepts/{slug}",
    "/docs/getting-started/{slug}",
    "/docs/reference/{slug}",
  ];

  const allPatterns = [
    ...(urlPatterns ?? []),
    ...defaultPatterns,
  ].filter((p, i, arr) => arr.indexOf(p) === i);

  const urls: string[] = [];
  const seen = new Set<string>();

  for (const pattern of allPatterns) {
    for (const slug of [hyphenSlug, slashSlug]) {
      const path = pattern.replace("{slug}", slug);
      const url = `${origin}${path}`;
      if (!seen.has(url)) {
        seen.add(url);
        urls.push(url);
      }
    }
  }

  return urls;
}

async function fetchFirstSuccessful(
  urls: string[],
  minLength = 300,
): Promise<FetchResult | null> {
  if (urls.length === 0) return null;

  try {
    return await Promise.any(
      urls.map(async (url) => {
        const content = await fetchViaJina(url);
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

async function fetchMultiplePages(
  urls: string[],
  maxPages: number,
): Promise<Array<{ content: string; url: string }>> {
  const batch = urls.slice(0, maxPages);
  const results = await Promise.allSettled(
    batch.map(async (url) => {
      const content = await fetchViaJina(url);
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

function assemblePages(
  pages: Array<{ content: string; url: string }>,
): string {
  return pages
    .map((p) => `## Source: ${p.url}\n\n${p.content}`)
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
): Promise<FetchResult> {
  if (!topic || topic.trim().length === 0) return initialResult;

  const relevance = scoreTopicRelevance(initialResult.content, topic);
  if (relevance >= DEEP_FETCH_RELEVANCE_THRESHOLD) return initialResult;

  const pipeline = async (): Promise<FetchResult> => {
    const topicUrls = buildTopicUrls(docsUrl, topic, urlPatterns);
    if (topicUrls.length > 0) {
      const directHit = await fetchFirstSuccessful(topicUrls.slice(0, 6));
      if (directHit) return directHit;
    }

    if (isIndexContent(initialResult.content)) {
      const ranked = rankIndexLinks(initialResult.content, topic);
      const pages = await fetchMultiplePages(ranked, maxPages);
      if (pages.length > 0) {
        return {
          content: assemblePages(pages),
          url: pages[0]!.url,
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
            url: pages[0]!.url,
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
            url: pages[0]!.url,
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
  } catch {
    return initialResult;
  }
}
