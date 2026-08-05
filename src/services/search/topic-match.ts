import { TOPIC_URL_MAP } from "../../sources/topic-urls.js";

/** Cache compiled regexes for topic patterns to avoid re-creation per call */
const patternRegexCache = new Map<string, RegExp>();

function matchesPattern(query: string, pattern: string): boolean {
  // Multi-word patterns and long patterns: simple includes is safe
  if (pattern.length >= 5 || pattern.includes(" ")) {
    return query.includes(pattern);
  }
  // Short patterns (< 5 chars): use word boundary to prevent substring matches
  // e.g. "ts" must not match "robots" or "events"
  let re = patternRegexCache.get(pattern);
  if (!re) {
    const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    re = new RegExp(`(?:^|[\\s,;:()\\[\\]/])${escaped}(?:$|[\\s,;:()\\[\\]/])`, "i");
    if (patternRegexCache.size >= 500) patternRegexCache.clear();
    patternRegexCache.set(pattern, re);
  }
  return re.test(query);
}

export function findTopicUrls(query: string): Array<{ urls: string[]; name: string }> {
  const q = query.toLowerCase();
  const matches: Array<{ urls: string[]; name: string; score: number }> = [];

  for (const topic of TOPIC_URL_MAP) {
    let score = 0;
    for (const pattern of topic.patterns) {
      if (matchesPattern(q, pattern)) {
        score += pattern.split(" ").length; // longer matches score higher
      }
    }
    if (score > 0) {
      matches.push({ ...topic, score });
    }
  }

  matches.sort((a, b) => b.score - a.score);
  // Specificity gate: when a multi-word / specific topic matched (score >= 2), drop
  // single-word generic co-matches (score 1). This is what kept "OWASP SQL injection
  // prevention" from also returning the generic PostgreSQL "sql" reference page.
  // When the best match is itself only score 1 (e.g. the bare query "sql"), keep all.
  const maxScore = matches[0]?.score ?? 0;
  const gated = maxScore >= 2 ? matches.filter((m) => m.score >= 2) : matches;
  return gated.slice(0, 3);
}
