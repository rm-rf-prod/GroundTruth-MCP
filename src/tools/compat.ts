import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { fetchAsMarkdownRace } from "../services/fetcher.js";
import { fetchMdnDocMeta, renderBcdTable, formatBaseline } from "../services/mdn-bcd.js";
import { extractRelevantContent } from "../utils/extract.js";
import { checkEvidence, buildEvidenceBlock } from "../utils/evidence.js";
import { sanitizeContent } from "../utils/sanitize.js";
import { withNotice } from "../utils/guard.js";
import { docCache } from "../services/cache.js";
import { findTopicUrls, searchMDN } from "./search.js";
import { DEFAULT_TOKEN_LIMIT, MAX_TOKEN_LIMIT } from "../constants.js";

const InputSchema = z.object({
  feature: z
    .string()
    .min(1)
    .max(300)
    .describe(
      "Feature to check: 'CSS container queries', 'Array.at()', 'fetch() browser support', 'WebAssembly'",
    ),
  environments: z
    .array(z.string().max(50))
    .max(10)
    .optional()
    .describe("Environments to focus on, e.g. ['chrome', 'firefox', 'safari', 'node', 'deno']"),
  tokens: z
    .number()
    .int()
    .min(1000)
    .max(MAX_TOKEN_LIMIT)
    .default(DEFAULT_TOKEN_LIMIT)
    .describe("Max tokens for content"),
});

export function registerCompatTool(server: McpServer): void {
  server.registerTool(
    "gt_compat",
    {
      title: "Check Browser/Runtime Compatibility",
      description: `Check browser, Node.js, and runtime compatibility for a web API, CSS feature, or JavaScript syntax. Fetches live data from MDN Web Docs and caniuse.com.

Use this when the question is specifically about which browsers or runtimes support a feature (e.g. "does Safari support container queries?", "which Node.js version added Array.at()"). Takes a feature string — not a library name. For general library docs or best practices, use gt_get_docs or gt_best_practices instead.`,
      inputSchema: InputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ feature, environments, tokens }) => {
      // No extraction guard: `feature` is a web-platform feature description,
      // not a registry key — guarding it refused ordinary queries like
      // "does Safari support the full :has() selector list".
      const envFilter = environments?.map((e) => e.toLowerCase()).join(", ") ?? "";
      const cacheKey = `compat:${feature}:${envFilter}:${tokens}`;
      const cached = docCache.get(cacheKey);
      if (typeof cached === "string") {
        try {
          const envelope = JSON.parse(cached) as { text?: string; structuredContent?: Record<string, unknown> };
          if (typeof envelope.text === "string") {
            return {
              content: [{ type: "text", text: envelope.text }],
              ...(envelope.structuredContent ? { structuredContent: envelope.structuredContent } : {}),
            };
          }
        } catch { /* pre-envelope cache entry — plain rendered text */ }
        return { content: [{ type: "text", text: cached }] };
      }

      const featureEncoded = encodeURIComponent(feature);
      const results: string[] = [];
      const sources: Array<{ url: string; sourceType?: string }> = [];
      let weakEvidence = false;
      const searchTopic = envFilter
        ? `${feature} ${envFilter} compatibility`
        : `${feature} browser support compatibility`;

      // 1. Resolve a REAL MDN document for the feature: topic map first, then
      // MDN's official search JSON API. Fetching actual doc pages (which carry
      // the browser-compat tables) replaces the old fallback of scraping the
      // MDN search RESULTS page — a link list with no compat data.
      const topicMatches = findTopicUrls(feature);
      const mdnCandidates: string[] = topicMatches
        .flatMap((t) => t.urls)
        .filter((u) => u.includes("mozilla.org"));
      // Always append MDN search hits: topic-map entries are often GUIDE pages
      // that carry no BCD paths — the reference page (with the compat table)
      // only surfaces via search.
      const apiHits = await searchMDN(feature);
      for (const hit of apiHits.slice(0, 5)) {
        if (!mdnCandidates.includes(hit.url)) mdnCandidates.push(hit.url);
      }
      // Reference pages carry the compat data; guides rarely do. Probe them first.
      const isGuideUrl = (u: string): boolean => /\/(Guides?|Learn)\//i.test(u);
      mdnCandidates.sort((a, b) => Number(isGuideUrl(a)) - Number(isGuideUrl(b)));

      // 1a. PRIMARY: MDN machine-readable data. {doc}/index.json carries the
      // summary, Baseline status, and the BCD query paths; the BCD API returns
      // exact per-browser version_added (incl. Node/Deno/Bun). Rendered-page
      // scraping loses these tables — this path never does.
      let bcdHit = false;
      for (const candidateUrl of mdnCandidates.slice(0, 6)) {
        const meta = await fetchMdnDocMeta(candidateUrl);
        if (!meta || meta.browserCompat.length === 0) continue;
        // Relevance gate: the resolved doc must actually be about the feature.
        if (checkEvidence(`${meta.title}\n${meta.summary}`, feature).matchRatio === 0) continue;

        const tables = (
          await Promise.all(meta.browserCompat.slice(0, 3).map((p) => renderBcdTable(p, environments)))
        ).filter((t): t is string => t !== null);
        if (tables.length === 0) continue;

        const baselineLine = formatBaseline(meta.baseline);
        results.push(
          [
            `## MDN Web Docs — ${meta.title || feature}`,
            "",
            meta.summary,
            baselineLine ? `\n**${baselineLine}**` : "",
            "",
            tables.join("\n\n"),
            "",
            "(Live browser-compat data from MDN BCD.)",
          ]
            .filter((l) => l !== "")
            .join("\n"),
        );
        sources.push({ url: candidateUrl, sourceType: "mdn-bcd" });
        bcdHit = true;
        break;
      }

      // 1b. Fallback: rendered MDN page via markdown conversion.
      if (!bcdHit) {
        for (const candidateUrl of mdnCandidates.slice(0, 2)) {
          const mdnContent = await fetchAsMarkdownRace(candidateUrl);
          if (mdnContent && mdnContent.length > 200) {
            const safe = sanitizeContent(mdnContent);
            const { text } = extractRelevantContent(safe, searchTopic, Math.floor(tokens * 0.6));
            if (text.length > 100 && checkEvidence(text, feature).matchRatio > 0) {
              results.push(`## MDN Web Docs\n\n${text}`);
              sources.push({ url: candidateUrl, sourceType: "mdn" });
              break;
            }
          }
        }
      }

      // 2. caniuse.com — especially useful for CSS and browser-specific APIs
      const isCssOrBrowser = /css|html|browser|webkit|layout|paint|grid|flex|animation|transition/i.test(
        feature,
      );
      if (!bcdHit && (results.length === 0 || isCssOrBrowser)) {
        const caniuseUrl = `https://caniuse.com/?search=${featureEncoded}`;
        const caniuseContent = await fetchAsMarkdownRace(caniuseUrl);
        if (caniuseContent && caniuseContent.length > 200) {
          const safe = sanitizeContent(caniuseContent);
          const { text } = extractRelevantContent(safe, `${feature} browser support`, Math.floor(tokens * 0.4));
          if (text.length > 100 && checkEvidence(text, feature).matchRatio > 0) {
            results.push(`## Can I Use\n\n${text}`);
            sources.push({ url: caniuseUrl, sourceType: "caniuse" });
          }
        }
      }

      // 3. Last resort: MDN search results page — explicitly labeled as weak
      // evidence (it is a link list, not a compat table).
      if (results.length === 0) {
        const searchUrl = `https://developer.mozilla.org/en-US/search?q=${featureEncoded}+browser+compatibility`;
        const searchContent = await fetchAsMarkdownRace(searchUrl);
        if (searchContent && searchContent.length > 200) {
          const safe = sanitizeContent(searchContent);
          const { text } = extractRelevantContent(safe, searchTopic, Math.floor(tokens * 0.4));
          if (text.length > 100 && checkEvidence(text, feature).matchRatio > 0) {
            weakEvidence = true;
            results.push(`## MDN search results (weak evidence — follow the links for compat tables)\n\n${text}`);
            sources.push({ url: searchUrl, sourceType: "mdn-search" });
          }
        }
      }

      if (results.length === 0) {
        const text = withNotice(
          [
            `# ${feature} — no compatibility evidence found`,
            "",
            `No MDN document or caniuse entry with verifiable data for "${feature}" could be fetched. Rather than guess, check directly:`,
            `- https://developer.mozilla.org/en-US/search?q=${featureEncoded}`,
            `- https://caniuse.com/?search=${featureEncoded}`,
            "",
            "Tip: use the exact feature name (e.g. 'container queries', 'Array.prototype.at') — marketing names often miss.",
          ].join("\n"),
        );
        return { content: [{ type: "text", text }], structuredContent: { feature, environments: environments ?? [], sources: [], evidence: { ok: false, verdict: "miss" } } };
      }

      const evidenceCheck = checkEvidence(results.join("\n\n"), feature);
      const header = [
        `# Browser Compatibility: ${feature}`,
        envFilter ? `Focused on: ${envFilter}` : "",
        weakEvidence ? `> Evidence: Weak — only search results matched; verify in the linked pages.` : "",
        "",
      ]
        .filter(Boolean)
        .join("\n");

      const evidenceBlock = buildEvidenceBlock({ sources, topic: feature, check: evidenceCheck });
      const response = withNotice(`${header}\n\n${results.join("\n\n---\n\n")}${evidenceBlock}`);
      const structuredContent = {
        feature,
        environments: environments ?? [],
        sources: sources.map((s) => s.url),
        evidence: {
          // BCD data comes from the resolved MDN doc for this exact feature
          // (relevance-gated above) — authoritative regardless of how many
          // times the feature name recurs in the table text.
          ok: bcdHit || (evidenceCheck.ok && !weakEvidence),
          matchRatio: evidenceCheck.matchRatio,
          occurrences: evidenceCheck.occurrences,
          verdict: bcdHit ? "strong" : weakEvidence ? "weak" : evidenceCheck.ok ? "strong" : "weak",
        },
      };
      // Envelope keeps evidence.ok available on cache hits — a bare string
      // cache silently dropped the whole structuredContent block.
      docCache.set(cacheKey, JSON.stringify({ text: response, structuredContent }));

      return {
        content: [{ type: "text", text: response }],
        structuredContent,
      };
    },
  );
}
