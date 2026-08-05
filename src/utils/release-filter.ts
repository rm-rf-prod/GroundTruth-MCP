import { parseMajor } from "./version-band.js";

/**
 * Trim GitHub release notes (the "## Recent Releases" blob) to entries whose
 * tag major version falls in the requested band. Keeps the leading header and
 * falls back to the raw text when nothing matches, so the section is never
 * blanked.
 */
export function filterReleasesByVersion(raw: string, fromVersion?: string, toVersion?: string): string {
  const fromMajor = parseMajor(fromVersion);
  const toMajor = parseMajor(toVersion);
  if (fromMajor === undefined && toMajor === undefined) return raw;
  // Open the lower bound when only toVersion is supplied — otherwise low===high
  // and only the single exact-major release survives the band filter.
  const low = fromMajor ?? -Infinity;
  const high = toMajor ?? Infinity;
  const parts = raw.split(/\n(?=###\s)/);
  const header = parts.length > 0 && !parts[0]!.startsWith("###") ? parts.shift()! : "";
  // Headerless fragments (release-please style "### Features"/"### Bug Fixes"
  // sub-headers under a versioned release) inherit the preceding versioned
  // fragment's decision instead of being dropped — dropping them stripped the
  // actual changelog content out of every release body.
  let lastInclude = false;
  const kept = parts.filter((entry) => {
    const major = parseMajor(entry.split("\n", 1)[0] ?? "");
    if (major !== undefined) {
      lastInclude = major >= low && major <= high;
      return lastInclude;
    }
    return lastInclude;
  });
  if (kept.length === 0) return raw;
  return (header ? `${header.trimEnd()}\n` : "") + kept.join("\n");
}
