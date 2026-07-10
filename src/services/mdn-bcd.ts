import { fetchWithTimeout } from "./fetcher.js";
import { log } from "../utils/logger.js";

/**
 * MDN machine-readable compatibility data.
 *
 * Every MDN doc page serves `{url}/index.json` containing the page summary,
 * Baseline status, and the exact BCD query paths for its compat tables. The
 * BCD API then returns per-browser `version_added` as JSON — including
 * Node.js, Deno, and Bun. This replaces scraping rendered MDN pages, which
 * lose or mangle the compat tables in markdown conversion.
 */

const BCD_API_BASE = "https://bcd.developer.mozilla.org/bcd/api/v0/current/";
const FETCH_TIMEOUT_MS = 10_000;

export interface MdnDocMeta {
  title: string;
  summary: string;
  browserCompat: string[];
  baseline: { level: string; lowDate?: string; highDate?: string } | null;
  mdnUrl: string;
}

interface BcdSupportStatement {
  version_added?: string | boolean | null;
  version_removed?: string | boolean;
  partial_implementation?: boolean;
  flags?: unknown[];
  prefix?: string;
}

const BROWSER_LABELS: ReadonlyArray<readonly [string, string]> = [
  ["chrome", "Chrome"],
  ["edge", "Edge"],
  ["firefox", "Firefox"],
  ["safari", "Safari"],
  ["chrome_android", "Chrome Android"],
  ["firefox_android", "Firefox Android"],
  ["safari_ios", "Safari iOS"],
  ["samsunginternet_android", "Samsung Internet"],
  ["nodejs", "Node.js"],
  ["deno", "Deno"],
  ["bun", "Bun"],
];

function docIndexJsonUrl(docUrl: string): string | null {
  try {
    const u = new URL(docUrl);
    if (!u.hostname.endsWith("mozilla.org")) return null;
    const path = u.pathname.replace(/\/+$/, "");
    if (path.endsWith("/index.json")) return `${u.origin}${path}`;
    return `${u.origin}${path}/index.json`;
  } catch {
    return null;
  }
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetchWithTimeout(url, FETCH_TIMEOUT_MS, { Accept: "application/json" });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

export async function fetchMdnDocMeta(docUrl: string): Promise<MdnDocMeta | null> {
  const jsonUrl = docIndexJsonUrl(docUrl);
  if (!jsonUrl) return null;
  try {
    const raw = await fetchJson(jsonUrl);
    const doc = (raw as { doc?: Record<string, unknown> }).doc;
    if (!doc || typeof doc !== "object") return null;

    const browserCompat = Array.isArray(doc["browserCompat"])
      ? doc["browserCompat"].filter((p): p is string => typeof p === "string")
      : [];

    let baseline: MdnDocMeta["baseline"] = null;
    const rawBaseline = doc["baseline"];
    if (rawBaseline && typeof rawBaseline === "object") {
      const b = rawBaseline as Record<string, unknown>;
      const level = b["baseline"];
      baseline = {
        level: level === "high" ? "high" : level === "low" ? "low" : "limited",
      };
      if (typeof b["baseline_low_date"] === "string") baseline.lowDate = b["baseline_low_date"];
      if (typeof b["baseline_high_date"] === "string") baseline.highDate = b["baseline_high_date"];
    }

    return {
      title: typeof doc["pageTitle"] === "string" ? doc["pageTitle"] : "",
      summary: typeof doc["summary"] === "string" ? doc["summary"] : "",
      browserCompat,
      baseline,
      mdnUrl: docUrl,
    };
  } catch (err) {
    log({ level: "debug", msg: "mdn-bcd.doc_meta_failed", url: jsonUrl, error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

function findCompatNode(node: unknown): Record<string, unknown> | null {
  if (!node || typeof node !== "object") return null;
  const obj = node as Record<string, unknown>;
  if (obj["__compat"] && typeof obj["__compat"] === "object") {
    return obj["__compat"] as Record<string, unknown>;
  }
  for (const value of Object.values(obj)) {
    const found = findCompatNode(value);
    if (found) return found;
  }
  return null;
}

function formatSupport(raw: unknown): string {
  // A browser's support can be one statement or an array (newest first).
  // Prefer the first statement that is not flag-gated.
  const statements: BcdSupportStatement[] = Array.isArray(raw)
    ? (raw as BcdSupportStatement[])
    : raw && typeof raw === "object"
      ? [raw]
      : [];
  const usable = statements.find((s) => !s.flags) ?? statements[0];
  if (!usable) return "unknown";

  const added = usable.version_added;
  let text: string;
  if (typeof added === "string") text = added;
  else if (added === true) text = "yes";
  else if (added === false) text = "no";
  else text = "unknown";

  if (typeof usable.version_removed === "string") text += ` (removed ${usable.version_removed})`;
  if (usable.partial_implementation) text += " (partial)";
  if (usable.prefix) text += ` (prefix ${usable.prefix})`;
  if (usable.flags) text += " (behind flag)";
  return text;
}

function selectRows(environments?: string[]): ReadonlyArray<readonly [string, string]> {
  if (!environments || environments.length === 0) return BROWSER_LABELS;
  const wanted = environments.map((e) => e.toLowerCase());
  const filtered = BROWSER_LABELS.filter(([key, label]) =>
    wanted.some((w) => key.includes(w) || label.toLowerCase().includes(w)),
  );
  return filtered.length > 0 ? filtered : BROWSER_LABELS;
}

export async function renderBcdTable(
  bcdPath: string,
  environments?: string[],
): Promise<string | null> {
  if (!/^[a-zA-Z0-9_.@-]+$/.test(bcdPath)) return null;
  try {
    const raw = await fetchJson(`${BCD_API_BASE}${encodeURIComponent(bcdPath)}.json`);
    const compat = findCompatNode(raw);
    if (!compat) return null;
    const support = compat["support"];
    if (!support || typeof support !== "object") return null;
    const supportMap = support as Record<string, unknown>;

    const rows: string[] = [];
    for (const [key, label] of selectRows(environments)) {
      if (!(key in supportMap)) continue;
      rows.push(`| ${label} | ${formatSupport(supportMap[key])} |`);
    }
    if (rows.length === 0) return null;

    const status = compat["status"] as Record<string, unknown> | undefined;
    const flags: string[] = [];
    if (status?.["deprecated"] === true) flags.push("DEPRECATED");
    if (status?.["experimental"] === true) flags.push("experimental");
    if (status?.["standard_track"] === false) flags.push("non-standard");

    return [
      `### Support: \`${bcdPath}\`${flags.length > 0 ? ` — ${flags.join(", ")}` : ""}`,
      "",
      "| Environment | Version added |",
      "| --- | --- |",
      ...rows,
    ].join("\n");
  } catch (err) {
    log({ level: "debug", msg: "mdn-bcd.table_failed", path: bcdPath, error: err instanceof Error ? err.message : String(err) });
    return null;
  }
}

export function formatBaseline(baseline: MdnDocMeta["baseline"]): string {
  if (!baseline) return "";
  if (baseline.level === "high") {
    return `Baseline: Widely available${baseline.highDate ? ` since ${baseline.highDate}` : ""} (supported across all major browsers).`;
  }
  if (baseline.level === "low") {
    return `Baseline: Newly available${baseline.lowDate ? ` since ${baseline.lowDate}` : ""} (recently reached cross-browser support).`;
  }
  return "Baseline: Limited availability (not yet supported in all major browsers).";
}
