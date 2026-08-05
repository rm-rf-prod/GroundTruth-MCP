/**
 * Documentation URL joining.
 *
 * Registry entries store `bestPracticesPaths` and `urlPatterns` as
 * root-relative paths ("/guides/auth"). Joining them to the docsUrl ORIGIN
 * alone is wrong for every docs site that lives under a sub-path:
 *
 *   docsUrl https://supabase.com/docs + "/guides/auth"
 *     origin-joined -> https://supabase.com/guides/auth        (404)
 *     base-joined   -> https://supabase.com/docs/guides/auth   (correct)
 *
 * Measured on the shipped registry: 46 entries produced a dead origin-joined
 * URL, 17 of which resolve once the docs base segment is kept (Supabase,
 * Prisma, Radix UI, PostgreSQL, Ruff, FlashList, React Native Web, ...).
 *
 * Callers race or try several candidates already, so this returns BOTH forms
 * ordered most-likely-first rather than guessing one.
 */

/**
 * Base segments that name a docs SECTION rather than a project. Registry
 * patterns are written with these already in them ("/docs/{slug}"), so the
 * origin-joined form is tried first. A base segment outside this set is a
 * project slug (react-native-screens, husky, adk-docs) that must be kept.
 */
const GENERIC_BASE_SEGMENTS = new Set([
  "docs", "doc", "documentation", "guide", "guides", "en", "latest", "stable",
  "reference", "api", "learn", "manual", "help", "handbook",
]);

/** First path segment of a docs URL ("/docs/guides" -> "docs"), or "" at root. */
export function docsBaseSegment(docsUrl: string): string {
  try {
    return new URL(docsUrl).pathname.split("/").filter(Boolean)[0] ?? "";
  } catch {
    return "";
  }
}

/**
 * Expand one registry path into the candidate absolute URLs worth trying.
 * Absolute inputs pass through unchanged. Paths that already carry the docs
 * base segment yield a single URL — no duplicate work for the common case.
 */
export function joinDocPath(docsUrl: string, path: string): string[] {
  if (path.startsWith("http://") || path.startsWith("https://")) return [path];

  let origin: string;
  try {
    origin = new URL(docsUrl).origin;
  } catch {
    return [];
  }

  const rel = path.startsWith("/") ? path : `/${path}`;
  const seg = docsBaseSegment(docsUrl);
  if (!seg || rel === `/${seg}` || rel.startsWith(`/${seg}/`)) return [`${origin}${rel}`];

  const originJoined = `${origin}${rel}`;
  const baseJoined = `${origin}/${seg}${rel}`;
  // Project-slug bases (docs.swmansion.com/react-native-screens) must keep the
  // segment or every URL 404s; generic section bases keep the historical order.
  return GENERIC_BASE_SEGMENTS.has(seg)
    ? [originJoined, baseJoined]
    : [baseJoined, originJoined];
}

/** Expand many registry paths, preserving order and dropping duplicates. */
export function joinDocPaths(docsUrl: string, paths: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const p of paths) {
    for (const url of joinDocPath(docsUrl, p)) {
      if (seen.has(url)) continue;
      seen.add(url);
      out.push(url);
    }
  }
  return out;
}
