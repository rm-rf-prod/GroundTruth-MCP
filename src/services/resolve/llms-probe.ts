import { fetchWithTimeout } from "../fetcher.js";
import { llmsProbeCache, diskDocCache } from "../cache.js";
import { isKnownMissing, rememberMissing } from "../http/negative-cache.js";
import { singleFlight } from "../http/single-flight.js";
import { assertPublicUrl } from "../../utils/guard.js";

type ProbeResult = { llmsTxtUrl?: string; llmsFullTxtUrl?: string };

/** Probe answers (negatives included) change rarely; persisting them spares every new process the round trips. */
const PROBE_TTL_MS = 24 * 60 * 60 * 1000;

const inFlightProbes = new Map<string, Promise<ProbeResult>>();

/**
 * Normalize a homepage URL for safe path concatenation.
 * Strips URL fragment (#readme) + query (?utm) + trailing slashes — these break
 * `${homepage}/llms.txt` style concat by producing URLs like
 * `https://github.com/x/y#readme/llms.txt` (invalid).
 */
function normalizeHomepageForProbe(homepage: string): string | null {
  try {
    const u = new URL(homepage);
    u.hash = "";
    u.search = "";
    // Strip trailing slashes from pathname (keep "/" if pathname IS just "/")
    if (u.pathname.length > 1) {
      u.pathname = u.pathname.replace(/\/+$/, "");
    }
    return u.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

/** "unknown" = offline, timeout, 403/429/5xx: no answer about the file, so never persisted. */
type Probe = "found" | "missing" | "unknown";

/** HEAD-like existence check: the body (llms-full.txt can be megabytes) is never downloaded. */
async function exists(url: string): Promise<Probe> {
  if (isKnownMissing(url)) return "missing";
  try {
    const res = await fetchWithTimeout(url, 5000);
    void res.body?.cancel().catch(() => {});
    if (res.status === 404 || res.status === 410) {
      rememberMissing(url);
      return "missing";
    }
    if (!res.ok) return "unknown";
    // A redirect onto an HTML page (radix-ui.com does this) is not an llms.txt.
    return /html/i.test(res.headers?.get("content-type") ?? "") ? "missing" : "found";
  } catch {
    return "unknown";
  }
}

function parseProbe(raw: string | undefined): ProbeResult | undefined {
  if (!raw) return undefined;
  try {
    const v: unknown = JSON.parse(raw);
    return v && typeof v === "object" && !Array.isArray(v) ? v : undefined;
  } catch {
    return undefined;
  }
}

export async function probeLlmsTxt(homepage: string): Promise<ProbeResult> {
  const base = normalizeHomepageForProbe(homepage);
  if (!base) return {};
  try { assertPublicUrl(base); } catch { return {}; }
  const { origin, hostname } = new URL(base);
  // A repo page has no llms.txt, and github.com/llms.txt is GitHub's own product index.
  if (hostname === "github.com") return {};

  // Key on the full normalized base path, not just the origin: two libraries on
  // the same host (docs.example.com/react vs /vue) must not share a probe result.
  const cacheKey = `llms-probe:${base}`;
  const memHit = llmsProbeCache.get(cacheKey);
  if (memHit) return memHit;
  const diskHit = parseProbe(await diskDocCache.get(cacheKey));
  if (diskHit) {
    llmsProbeCache.set(cacheKey, diskHit);
    return diskHit;
  }
  // Detached: a cancelled call must not abort the probes into a cached {} for everyone.
  return singleFlight(inFlightProbes, cacheKey, () => probeNetwork(base, origin, cacheKey));
}

async function probeNetwork(base: string, origin: string, cacheKey: string): Promise<ProbeResult> {
  // Docs-scoped first, then the site-wide spots (firebase.google.com serves
  // /docs/llms.txt and 404s at the root). Never `${base}/docs/`: for a /docs
  // docsUrl that is /docs/docs/llms.txt. One parallel round, not serial stages.
  const bases = [...new Set([base, `${origin}/docs`, origin])];
  const found = await Promise.all(
    bases.map(async (b) => {
      const [full, txt] = await Promise.all([exists(`${b}/llms-full.txt`), exists(`${b}/llms.txt`)]);
      return { b, full, txt };
    }),
  );
  const hitAt = found.findIndex((f) => f.full === "found" || f.txt === "found");
  const hit = found[hitAt];
  const result: ProbeResult = {};
  if (hit?.full === "found") result.llmsFullTxtUrl = `${hit.b}/llms-full.txt`;
  if (hit?.txt === "found") result.llmsTxtUrl = `${hit.b}/llms.txt`;

  llmsProbeCache.set(cacheKey, result);
  // Persist only an answer a retry could not change: every probe at or before
  // the chosen base must have been definitive. Otherwise memory-only, as before.
  const decided = hitAt === -1 ? found : found.slice(0, hitAt + 1);
  if (decided.every((f) => f.full !== "unknown" && f.txt !== "unknown")) {
    void diskDocCache.set(cacheKey, JSON.stringify(result), PROBE_TTL_MS);
  }
  return result;
}
