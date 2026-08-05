import { tokenize, expandTopicTokens } from "../utils/extract.js";
import { joinDocPath } from "../utils/url-join.js";
import { DEFAULT_URL_PATTERNS } from "../sources/doc-url-patterns.js";

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
  const tokenScore = found / topicTokens.length;

  let phraseScore = 0;
  if (topicTokens.length >= 2) {
    const phrases: string[] = [];
    for (let i = 0; i < topicTokens.length - 1; i++) {
      phrases.push(`${topicTokens[i]} ${topicTokens[i + 1]}`);
    }
    const fullPhrase = topic.toLowerCase().replace(/[^a-z0-9\s]/g, " ").trim();
    if (fullPhrase.length >= 5) phrases.push(fullPhrase);

    let phraseFound = 0;
    for (const phrase of phrases) {
      if (prose.includes(phrase)) phraseFound++;
    }
    phraseScore = phrases.length > 0 ? phraseFound / phrases.length : 0;
  }

  return topicTokens.length >= 2
    ? Math.min(tokenScore * 0.4 + phraseScore * 0.6, 1)
    : tokenScore;
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
  // Synonyms bridge caller vocabulary to docs vocabulary — a "migration"
  // query must find the "Upgrade guide" link.
  const topicTokens = expandTopicTokens(tokenize(topic));
  if (topicTokens.length === 0 || links.length === 0) return [];

  const scored = links.map((link) => {
    const urlSegments = link.url.toLowerCase().replace(/[^a-z0-9/]/g, " ");
    const combined = `${link.text.toLowerCase()} ${urlSegments}`;
    let score = 0;
    for (const token of topicTokens) {
      if (combined.includes(token)) score += 10;
    }
    // Archived version trees (…/2.x/…, /v1/, /legacy/) must not outrank the
    // current docs, which sites serve at the unversioned canonical path.
    if (/\/(?:v?\d+(?:\.x|\.\d+)?|legacy|previous|old|archive)(?:\/|$)/i.test(link.url)) score -= 5;
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
  try {
    new URL(docsUrl);
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

  const allPatterns = [
    ...(urlPatterns ?? []),
    ...DEFAULT_URL_PATTERNS,
  ].filter((p, i, arr) => arr.indexOf(p) === i);

  const urls: string[] = [];
  const seen = new Set<string>();

  for (const pattern of allPatterns) {
    for (const slug of [hyphenSlug, slashSlug]) {
      // joinDocPath keeps the docs base segment for sub-path docs sites
      // (docs.swmansion.com/react-native-screens/...), which origin-only
      // joining dropped — every guessed topic URL there 404'd.
      for (const url of joinDocPath(docsUrl, pattern.replace("{slug}", slug))) {
        if (seen.has(url)) continue;
        seen.add(url);
        urls.push(url);
      }
    }
  }

  return urls;
}
