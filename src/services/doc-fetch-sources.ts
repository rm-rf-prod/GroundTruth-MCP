import type { FetchResult } from "../types.js";
import { tryFetch } from "./http/try-fetch.js";
import { fetchViaJina } from "./http/jina.js";
import { JINA_HEDGE_MS, fetchDirect, fullDirect, hedge, type Direct } from "./http/markdown.js";
import { followNestedLlmsIndex } from "./llms-index.js";
import { MAX_SANITIZE_LENGTH } from "../utils/sanitize.js";

export interface LlmsDocs {
  main: FetchResult;
  /** The llms.txt index, kept when llms-full.txt is too large to survive sanitizing whole. */
  index?: FetchResult;
}

/**
 * llms-full.txt, else llms.txt (one hop into a nested index that matches the
 * docs path). Both are fetched in parallel. A topic query on an llms-full.txt
 * past the sanitize window would only ever see its first ~10% of sections, so
 * the index comes back too: deep fetch can follow it to any page.
 */
export async function fetchLlmsDocs(docsUrl: string, llmsTxtUrl?: string, llmsFullTxtUrl?: string): Promise<LlmsDocs | null> {
  const [full, txt] = await Promise.all([
    llmsFullTxtUrl ? tryFetch(llmsFullTxtUrl) : null,
    llmsTxtUrl ? tryFetch(llmsTxtUrl) : null,
  ]);
  const index = async (): Promise<FetchResult | undefined> => {
    if (!txt || !llmsTxtUrl) return undefined;
    const nested = await followNestedLlmsIndex(txt, llmsTxtUrl, docsUrl);
    return { ...(nested ?? { content: txt, url: llmsTxtUrl }), sourceType: "llms-txt" };
  };
  if (full && llmsFullTxtUrl) {
    const main: FetchResult = { content: full, url: llmsFullTxtUrl, sourceType: "llms-full-txt" };
    const idx = full.length > MAX_SANITIZE_LENGTH ? await index() : undefined;
    return idx ? { main, index: idx } : { main };
  }
  const main = await index();
  return main ? { main } : null;
}

/**
 * The docs page itself: direct fetch (server markdown, or converted HTML), with
 * Jina hedged behind it. Jina starts only once direct came back empty or after
 * JINA_HEDGE_MS, and never once `stop()` says another source already answered.
 */
export async function fetchPage(docsUrl: string, stop: () => boolean): Promise<FetchResult | null> {
  const direct = fetchDirect(docsUrl, 0).catch((): Direct => null);
  const full = direct.then(fullDirect);
  const jina = hedge(full, JINA_HEDGE_MS).then((directWon) => (directWon || stop() ? null : fetchViaJina(docsUrl)));
  const as = (p: Promise<string | null>, sourceType: "direct" | "jina"): Promise<FetchResult> =>
    p.then((content) => content ? { content, url: docsUrl, sourceType } : Promise.reject(new Error("no content")));
  // A thin conversion still beats nothing when Jina came back empty.
  return Promise.any([as(full, "direct"), as(jina, "jina")]).catch(() => as(direct.then((d) => d?.md ?? null), "direct")).catch(() => null);
}
