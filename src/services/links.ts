import { tokenize, expandTopicTokens } from "../utils/extract.js";
import { topicIdentifiers, identifierStems } from "../utils/tokenize.js";
import { countTokenHits, stripUrlNoise } from "../utils/evidence/match.js";
import { joinDocPath } from "../utils/url-join.js";
import { DEFAULT_URL_PATTERNS } from "../sources/doc-url-patterns.js";
import { isGitHubHost } from "./github.js";

const LEGACY_SEGMENT = /\/(?:v?\d+(?:\.x|\.\d+)?|legacy|previous|old|archive)(?:\/|$)/i;
const V_MAJOR = /\/v(\d+)(?:\.x|\.\d+)?(?:\/|$)/i;

export function scoreTopicRelevance(content: string, topic: string): number {
  const topicTokens = tokenize(topic);
  // KV, vi.mock: terms tokenize() drops or splits, matched whole at a word start.
  const ids = topicIdentifiers(topic).filter((id) => !topicTokens.includes(id));
  if (topicTokens.length + ids.length === 0) return 1;

  const prose = content
    .replace(/\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/https?:\/\/\S+/g, "")
    .toLowerCase();

  let found = 0;
  for (const token of topicTokens) {
    if (prose.includes(token)) found++;
  }
  for (const id of ids) {
    if (countTokenHits(prose, id) > 0) found++;
  }
  const tokenScore = found / (topicTokens.length + ids.length);

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

/** Every identifier in the topic (vi.mock, KV) appears as written in the prose or link text. */
export function hasTopicIdentifiers(content: string, topic: string): boolean {
  const ids = topicIdentifiers(topic);
  if (ids.length === 0) return true;
  const prose = stripUrlNoise(content).toLowerCase();
  return ids.every((id) => countTokenHits(prose, id) > 0);
}

/**
 * Scores a link title + URL against a topic, for both link rankers. Words are
 * synonym-expanded substrings, so a "migration" query finds "Upgrade guide".
 * Identifiers tokenize() drops or splits (KV, vi.mock) must sit at a word start.
 * CamelCase stems only break ties: they never admit a link that matched nothing.
 */
export function topicLinkScorer(topic: string): ((text: string, url: string) => number) | undefined {
  const ids = topicIdentifiers(topic);
  const words = expandTopicTokens(tokenize(topic)).filter((w) => !ids.includes(w));
  if (words.length + ids.length === 0) return undefined;
  const stems = identifierStems(topic);
  return (text, url) => {
    const raw = `${text} ${url}`.toLowerCase();
    const flat = `${text.toLowerCase()} ${url.toLowerCase().replace(/[^a-z0-9/]/g, " ")}`;
    let score = 0;
    for (const w of words) if (flat.includes(w)) score += 10;
    for (const id of ids) if (countTokenHits(raw, id) > 0) score += 10;
    if (score > 0) for (const s of stems) if (countTokenHits(raw, s) > 0) score += 1;
    return score;
  };
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
    // GitHub's file page is navigation chrome around the content; the raw file is the content.
    resolved = resolved.replace(/^https:\/\/github\.com\/([^/]+\/[^/]+)\/blob\//, "https://raw.githubusercontent.com/$1/");
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
  const scoreLink = topicLinkScorer(topic);
  if (!scoreLink || links.length === 0) return [];

  // With two or more /vN/ trees listed (prisma.io /orm/v6/ and /orm/v7/), the
  // newest is the current docs; a lone versioned tree is still an archive.
  const majors = new Set(links.map((l) => Number(V_MAJOR.exec(l.url)?.[1])).filter((n) => !Number.isNaN(n)));
  const currentMajor = majors.size >= 2 ? Math.max(...majors) : undefined;

  const scored = links.map((link) => {
    let score = scoreLink(link.text, link.url);
    // Archived version trees (…/2.x/…, /v1/, /legacy/) must not outrank the
    // current docs, which sites serve at the unversioned canonical path.
    const isCurrent = currentMajor !== undefined && Number(V_MAJOR.exec(link.url)?.[1]) === currentMajor;
    if (LEGACY_SEGMENT.test(link.url) && !isCurrent) score -= 5;
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
  // Doc-site paths (/docs/{slug}) never exist under a repo URL; repo files live under /blob/<ref>/.
  if (isGitHubHost(docsUrl)) return [];

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
