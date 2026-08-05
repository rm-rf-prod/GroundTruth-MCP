/**
 * Parse the major version integer from a version string.
 * "15" -> 15, "v15.2.0" -> 15, "v3" -> 3. Returns undefined when no
 * version-like number is present or it looks like a calendar year (>= 1000),
 * which guards against parsing dates ("2026") as versions.
 */
export function parseMajor(version?: string): number | undefined {
  if (!version) return undefined;
  const m = /v?(\d{1,4})/i.exec(version.trim());
  if (!m) return undefined;
  const n = Number(m[1]);
  if (!Number.isFinite(n) || n >= 1000) return undefined;
  return n;
}

/** Extract candidate major versions referenced in a single heading line. */
function headingVersions(heading: string): number[] {
  const out: number[] = [];
  const re = /\bv?(\d{1,3})(?:\.\d+)*\b/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(heading)) !== null) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n < 1000) out.push(n);
  }
  return out;
}

/**
 * Slice a documentation / changelog blob down to the section band relevant to a
 * version upgrade. Sections are delimited by markdown headings (# .. ###); a
 * section is kept when any version referenced in its heading falls inside the
 * inclusive [fromMajor, toMajor] band. Heading-less sub-sections inherit the
 * include state of the preceding versioned heading, so nested content under an
 * in-band heading survives and content under an out-of-band heading is dropped.
 *
 * This is the core fix for the gt_migration P0: without it, a "Next.js 15 -> 16"
 * query returned v8-v11 ancient sections because every historical "Upgrading..."
 * heading scored well on a version-blind BM25 pass. When neither bound is given,
 * or no versioned heading matches the band, the original content is returned
 * unchanged so callers never receive an empty result.
 */
export function sliceVersionBand(
  content: string,
  fromVersion?: string,
  toVersion?: string,
): string {
  const fromMajor = parseMajor(fromVersion);
  const toMajor = parseMajor(toVersion);
  if (fromMajor === undefined && toMajor === undefined) return content;

  // toVersion-only keeps the lower bound OPEN (mirror of migration.ts's
  // filterReleasesByVersion) — `?? toMajor` collapsed the band to one major.
  const lowBound = fromMajor ?? -Infinity;
  const highBound = toMajor ?? Infinity;

  interface Seg {
    versions: number[];
    lines: string[];
  }
  const segs: Seg[] = [];
  let current: Seg | null = null;
  let inFence = false;
  for (const line of content.split("\n")) {
    if (/^\s*(?:```|~~~)/.test(line)) inFence = !inFence;
    const h = inFence ? null : /^(#{1,3})\s+(.+)/.exec(line);
    if (h) {
      if (current) segs.push(current);
      current = { versions: headingVersions(h[2] ?? ""), lines: [line] };
    } else if (current) {
      current.lines.push(line);
    } else {
      current = { versions: [], lines: [line] };
    }
  }
  if (current) segs.push(current);

  let lastInclude = false;
  let anyVersionedInclude = false;
  const kept: string[] = [];
  for (const seg of segs) {
    let include: boolean;
    if (seg.versions.length > 0) {
      include = seg.versions.some((v) => v >= lowBound && v <= highBound);
      lastInclude = include;
      if (include) anyVersionedInclude = true;
    } else {
      include = lastInclude;
    }
    if (include) kept.push(seg.lines.join("\n"));
  }

  // No versioned section matched — return the original so we never blank out
  // content for docs that use a non-version heading structure.
  if (!anyVersionedInclude) return content;
  return kept.join("\n").trim();
}
