/** Skip generated, test, and declaration files — patterns don't apply there */
export const SKIP_FILE_RE = /(?:\.test\.[jt]sx?|\.spec\.[jt]sx?|\.d\.ts|__tests__[/\\]|\.stories\.[jt]sx?)$/;

/** Range-based comment map — O(n) build, O(log n) lookup, O(ranges) memory */
class CommentMap {
  private readonly ranges: [number, number][];
  constructor(ranges: [number, number][]) { this.ranges = ranges; }
  has(pos: number): boolean {
    let lo = 0, hi = this.ranges.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const r = this.ranges[mid]!;
      if (pos < r[0]) hi = mid - 1;
      else if (pos > r[1]) lo = mid + 1;
      else return true;
    }
    return false;
  }
  get size(): number { return this.ranges.length; }
}

/**
 * Build a CommentMap of block-comment ranges to reduce false positives.
 * String/template literals and // comments are skipped so a '/*' inside a
 * quoted glob like "**\/*.spec.ts" cannot open a bogus comment range that
 * hides all subsequent code from every audit pattern. Regex-literal contexts
 * are not handled (rare trigger, same as before).
 */
export function buildCommentMap(content: string): CommentMap {
  const ranges: [number, number][] = [];
  let i = 0;
  while (i < content.length) {
    const ch = content[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      i++;
      while (i < content.length) {
        if (content[i] === "\\") { i += 2; continue; }
        if (content[i] === ch) { i++; break; }
        i++;
      }
      continue;
    }
    if (ch === "/" && content[i + 1] === "/") {
      const nl = content.indexOf("\n", i);
      i = nl === -1 ? content.length : nl;
      continue;
    }
    if (ch === "/" && content[i + 1] === "*") {
      const end = content.indexOf("*/", i + 2);
      const stop = end === -1 ? content.length - 1 : end + 1;
      ranges.push([i, stop]);
      i = stop + 1;
      continue;
    }
    i++;
  }
  return new CommentMap(ranges);
}
