import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { fetchAsMarkdownRace } from "../services/fetcher.js";
import { extractRelevantContent } from "../utils/extract.js";
import { checkEvidence, buildEvidenceBlock } from "../utils/evidence.js";
import { sanitizeContent } from "../utils/sanitize.js";
import { isExtractionAttempt, withNotice, EXTRACTION_REFUSAL } from "../utils/guard.js";
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
      if (isExtractionAttempt(feature)) {
        return { content: [{ type: "text", text: EXTRACTION_REFUSAL }] };
      }

      const envFilter = environments?.map((e) => e.toLowerCase()).join(", ") ?? "";
      const cacheKey = `compat:${feature}:${envFilter}:${tokens}`;
      const cached = docCache.get(cacheKey);
      if (typeof cached === "string") {
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
      if (mdnCandidates.length === 0) {
        const apiHits = await searchMDN(feature);
        mdnCandidates.push(...apiHits.slice(0, 2).map((h) => h.url));
      }

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

      // 2. caniuse.com — especially useful for CSS and browser-specific APIs
      const isCssOrBrowser = /css|html|browser|webkit|layout|paint|grid|flex|animation|transition/i.test(
        feature,
      );
      if (results.length === 0 || isCssOrBrowser) {
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
      docCache.set(cacheKey, response);

      return {
        content: [{ type: "text", text: response }],
        structuredContent: {
          feature,
          environments: environments ?? [],
          sources: sources.map((s) => s.url),
          evidence: {
            ok: evidenceCheck.ok && !weakEvidence,
            matchRatio: evidenceCheck.matchRatio,
            occurrences: evidenceCheck.occurrences,
            verdict: weakEvidence ? "weak" : evidenceCheck.ok ? "strong" : "weak",
          },
        },
      };
    },
  );
}
