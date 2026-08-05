import { fetchGitHubContent, fetchGitHubReleases, fetchAsMarkdownRace } from "./fetcher.js";
import { checkEvidence } from "../utils/evidence.js";
import { webSearch } from "./search/engines.js";
import { isAuthoritativeUrl } from "./search/url-rank.js";
import { MIGRATION_PATHS, MIGRATION_URL_SUFFIXES, versionDocSuffixes } from "../sources/migration-paths.js";
import { filterReleasesByVersion } from "../utils/release-filter.js";

export interface MigrationSection {
  source: string;
  content: string;
}


/**
 * Version-specific upgrade guide — the gold-standard source when the target
 * version is known (e.g. nextjs.org/docs/app/guides/upgrading/version-16).
 * Fetched first and unconditionally so a stale monolithic docs/upgrading.md on
 * GitHub cannot pre-empt the correct page.
 */
export async function fetchVersionGuide(docsUrl: string, toVersion: string): Promise<MigrationSection | null> {
  try {
    const origin = new URL(docsUrl).origin;
    return await Promise.any(
      versionDocSuffixes(toVersion).map(async (suffix) => {
        const url = `${origin}${suffix}`;
        const content = await fetchAsMarkdownRace(url);
        if (content && content.length > 300) return { source: url, content };
        throw new Error("no content");
      }),
    );
  } catch {
    return null; // no version-specific page — callers fall through to other sources
  }
}

/** MIGRATION.md / UPGRADING.md style files plus filtered release notes. */
export async function fetchGitHubMigrationDocs(
  githubUrl: string,
  fromVersion: string | undefined,
  toVersion: string | undefined,
): Promise<MigrationSection[]> {
  const sections: MigrationSection[] = [];
  const migrationDocs = await Promise.allSettled(
    MIGRATION_PATHS.map(async (path) => {
      const result = await fetchGitHubContent(githubUrl, path);
      if (result && result.content.length > 200) {
        return { source: `GitHub: ${path}`, content: result.content };
      }
      throw new Error("no content");
    }),
  );
  for (const result of migrationDocs) {
    if (result.status === "fulfilled") {
      sections.push(result.value);
      if (sections.length >= 2) break;
    }
  }

  const releases = await fetchGitHubReleases(githubUrl);
  if (releases && releases.length > 200) {
    const relevant = (fromVersion || toVersion)
      ? filterReleasesByVersion(releases, fromVersion, toVersion)
      : releases;
    if (relevant.length > 200) sections.push({ source: "GitHub Releases", content: relevant });
  }
  return sections;
}

/**
 * Race the conventional upgrade-doc paths on the docs origin. Serial fetching
 * cost up to 7 timeouts (35s worst case); one round caps it at ~5s.
 */
export async function fetchConventionalUpgradeDocs(docsUrl: string): Promise<MigrationSection | null> {
  try {
    const origin = new URL(docsUrl).origin;
    return await Promise.any(
      MIGRATION_URL_SUFFIXES.map(async (suffix) => {
        const url = `${origin}${suffix}`;
        const content = await fetchAsMarkdownRace(url);
        if (content && content.length > 300) return { source: url, content };
        throw new Error("no content");
      }),
    );
  } catch {
    return null;
  }
}

/**
 * Release notes alone are not a migration guide. Official upgrade guides often
 * live at unguessable URLs (react.dev publishes them as dated blog posts) — find
 * them the way a human would, preferring the library's own docs host, then other
 * authoritative domains.
 */
export async function searchForUpgradeGuide(
  displayName: string,
  docsUrl: string,
  fromVersion: string | undefined,
  toVersion: string | undefined,
): Promise<MigrationSection | null> {
  let docsHost = "";
  try {
    docsHost = new URL(docsUrl).hostname;
  } catch { /* keep empty */ }

  const query = [
    displayName,
    "upgrade guide",
    fromVersion ? `from ${fromVersion.replace(/^v/, "")}` : "",
    toVersion ? `to ${toVersion.replace(/^v/, "")}` : "",
  ].filter(Boolean).join(" ");

  const found = await webSearch(query).catch(() => [] as string[]);
  const sameHost = found.filter((u) => {
    try {
      return new URL(u).hostname === docsHost;
    } catch {
      return false;
    }
  });
  const candidates = [...new Set([...sameHost, ...found.filter(isAuthoritativeUrl)])].slice(0, 3);

  // Fetched in one round, evaluated in rank order — the serial await this
  // replaces added up to 3 full fetch timeouts to a call that already spent its
  // budget on the guide + release paths.
  const fetched = await Promise.all(
    candidates.map((url) =>
      fetchAsMarkdownRace(url)
        .then((content) => ({ url, content }))
        .catch(() => ({ url, content: null as string | null })),
    ),
  );
  for (const { url, content } of fetched) {
    if (content && content.length > 500 && checkEvidence(content, "upgrade migration breaking changes").matchRatio > 0) {
      return { source: url, content };
    }
  }
  return null;
}
