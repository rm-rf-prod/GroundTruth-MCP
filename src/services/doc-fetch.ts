import { setTimeout as sleep } from "timers/promises";
import { CACHE_TTLS } from "../constants.js";
import type { FetchResult } from "../types.js";
import { singleFlight } from "./http/single-flight.js";
import { fetchGitHubContent, isGitHubHost } from "./github.js";
import { gitHubDocFile } from "./github-url.js";
import { probeLlmsTxt } from "./resolve/llms-probe.js";
import { cacheDocs, readDocs } from "./doc-fetch-cache.js";
import { fetchLlmsDocs, fetchPage, type LlmsDocs } from "./doc-fetch-sources.js";

const PROBE_GRACE_MS = 300;

type Probed = Awaited<ReturnType<typeof probeLlmsTxt>>;

interface Found extends LlmsDocs {
  ttl: number;
}

/**
 * Single-flight per cache key: two concurrent gt_get_docs / gt_auto_scan calls
 * for the same library must not each run the llms.txt -> page -> Jina chain.
 */
const inFlightDocs = new Map<string, Promise<LlmsDocs>>();

export async function fetchDocs(
  docsUrl: string,
  llmsTxtUrl?: string,
  llmsFullTxtUrl?: string,
  topic?: string,
): Promise<FetchResult> {
  // The llms files are part of the key: an entry fetched under other ones (an
  // older registry entry, a caller without them) must not answer for these.
  const key = llmsTxtUrl || llmsFullTxtUrl ? `docs:${docsUrl}|${llmsTxtUrl ?? ""}|${llmsFullTxtUrl ?? ""}` : `docs:${docsUrl}`;
  const refresh = (): Promise<LlmsDocs> => singleFlight(inFlightDocs, key, async () => {
    const found = await findDocs(docsUrl, llmsTxtUrl, llmsFullTxtUrl);
    if (!found) throw new Error(`Failed to fetch documentation from ${docsUrl}`);
    const main = cacheDocs(key, found.main, found.ttl);
    return found.index ? { main, index: cacheDocs(`${key}:index`, found.index, found.ttl) } : { main };
  });

  // A topic is answered from the llms.txt index when one was kept beside an oversized llms-full.txt.
  const cached = (topic ? await readDocs(`${key}:index`, docsUrl, refresh) : undefined)
    ?? (await readDocs(key, docsUrl, refresh));
  if (cached) return cached;
  const fresh = await refresh();
  return (topic ? fresh.index : undefined) ?? fresh.main;
}

async function findDocs(docsUrl: string, llmsTxtUrl?: string, llmsFullTxtUrl?: string): Promise<Found | null> {
  // 1. The registry's own llms files.
  if (llmsTxtUrl || llmsFullTxtUrl) {
    const llms = await fetchLlmsDocs(docsUrl, llmsTxtUrl, llmsFullTxtUrl);
    if (llms) return { ...llms, ttl: CACHE_TTLS.LLMS_TXT };
  }

  // GitHub-hosted docs: the repo page renders as navigation chrome and the
  // origin llms.txt is GitHub's own, so read the repo file raw instead.
  // Anonymous: docsUrl may be caller-supplied, and must not borrow the operator token.
  const ghFile = gitHubDocFile(docsUrl);
  if (ghFile) {
    const gh = await fetchGitHubContent(ghFile.repoUrl, ghFile.path, false);
    if (gh) return { main: gh, ttl: CACHE_TTLS.GITHUB_README };
  }

  // 2. Discover llms files while the page itself is already on its way, instead
  // of probing first: a discovered llms file still wins over the page, unless
  // the probe is still out PROBE_GRACE_MS after the page arrived (tailwindcss.com
  // takes 0.5-1.6 s to 404 /llms.txt). Its answer is persisted for the next fetch.
  let settled = false;
  const page = fetchPage(docsUrl, () => settled);
  // Never on github.com: its root llms.txt is GitHub's own product index.
  const probe: Promise<Probed> = isGitHubHost(docsUrl) ? Promise.resolve({}) : probeLlmsTxt(docsUrl);
  const probed = await Promise.race([probe, page.then((p): Promise<Probed> => (p ? sleep(PROBE_GRACE_MS, {}) : probe))]);
  if (probed.llmsTxtUrl || probed.llmsFullTxtUrl) {
    const llms = await fetchLlmsDocs(docsUrl, probed.llmsTxtUrl, probed.llmsFullTxtUrl);
    if (llms) {
      settled = true;
      return { ...llms, ttl: CACHE_TTLS.LLMS_TXT };
    }
  }
  const main = await page;
  settled = true;
  return main ? { main, ttl: CACHE_TTLS.DOCS_PAGE } : null;
}
