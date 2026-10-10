import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { withTelemetry } from "../services/telemetry.js";
import { checkEvidence, buildEvidenceBlock } from "../utils/evidence.js";
import { withNotice, withToolTimeout } from "../utils/guard.js";
import { docCache } from "../services/cache.js";
import {
  resolveMdnCandidates,
  fetchBcdSection,
  fetchRenderedMdn,
  fetchCaniuse,
  fetchMdnSearchPage,
  type CompatSection,
} from "../services/compat-sources.js";
import { DEFAULT_TOKEN_LIMIT, MAX_TOKEN_LIMIT } from "../constants.js";

const InputSchema = z.object({
  feature: z
    .string()
    .min(1)
    .max(300)
    .describe("e.g. 'CSS container queries'"),
  environments: z
    .array(z.string().max(50))
    .max(10)
    .optional()
    .describe("e.g. ['chrome', 'safari', 'node']"),
  tokens: z
    .number()
    .int()
    .min(1000)
    .max(MAX_TOKEN_LIMIT)
    .default(DEFAULT_TOKEN_LIMIT),
});

/** Returned when the whole pipeline exceeds the tool timeout — an actionable
 *  next step beats a hung call or an MCP-level timeout error. */
const TIMEOUT_RESPONSE = {
  content: [{ type: "text" as const, text: "Compatibility lookup timed out. Retry with a narrower feature name, or check the MDN page directly." }],
};

export function registerCompatTool(server: McpServer): void {
  server.registerTool(
    "gt_compat",
    {
      title: "Check Browser/Runtime Compatibility",
      description: "Browser and runtime support for a web API, CSS feature or JS syntax ('container queries', 'Array.at()'), from MDN and caniuse. Takes a feature, not a library.",
      inputSchema: InputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: true,
      },
    },
    async ({ feature, environments, tokens }) => {
      return withTelemetry("gt_compat", async (ctx) => {
        ctx.resolved = true;
        return withToolTimeout(async () => {
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
          const sections: CompatSection[] = [];
          let weakEvidence = false;
          const searchTopic = envFilter
            ? `${feature} ${envFilter} compatibility`
            : `${feature} browser support compatibility`;

          const candidates = await resolveMdnCandidates(feature);
          const bcd = await fetchBcdSection(candidates, feature, environments);
          if (bcd) sections.push(bcd);

          if (!bcd) {
            const rendered = await fetchRenderedMdn(candidates, feature, searchTopic, Math.floor(tokens * 0.6));
            if (rendered) sections.push(rendered);
          }

          const isCssOrBrowser = /css|html|browser|webkit|layout|paint|grid|flex|animation|transition/i.test(feature);
          if (!bcd && (sections.length === 0 || isCssOrBrowser)) {
            const caniuse = await fetchCaniuse(feature, Math.floor(tokens * 0.4));
            if (caniuse) sections.push(caniuse);
          }

          if (sections.length === 0) {
            const searchPage = await fetchMdnSearchPage(feature, searchTopic, Math.floor(tokens * 0.4));
            if (searchPage) {
              weakEvidence = true;
              sections.push(searchPage);
            }
          }

          if (sections.length === 0) {
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
            return {
              content: [{ type: "text", text }],
              structuredContent: { feature, environments: environments ?? [], sources: [], evidence: { ok: false, verdict: "miss" } },
            };
          }

          const evidenceCheck = checkEvidence(sections.map((s) => s.text).join("\n\n"), feature);
          const header = [
            `# Browser Compatibility: ${feature}`,
            envFilter ? `Focused on: ${envFilter}` : "",
            weakEvidence ? `> Evidence: Weak — only search results matched; verify in the linked pages.` : "",
            "",
          ]
            .filter(Boolean)
            .join("\n");

          const evidenceBlock = buildEvidenceBlock({
            sources: sections.map((s) => ({ url: s.url, sourceType: s.sourceType })),
            topic: feature,
            check: evidenceCheck,
          });
          const response = withNotice(`${header}\n\n${sections.map((s) => s.text).join("\n\n---\n\n")}${evidenceBlock}`);
          const structuredContent = {
            feature,
            environments: environments ?? [],
            sources: sections.map((s) => s.url),
            evidence: {
              // BCD data comes from the resolved MDN doc for this exact feature
              // (relevance-gated above) — authoritative regardless of how many
              // times the feature name recurs in the table text.
              ok: !!bcd || (evidenceCheck.ok && !weakEvidence),
              matchRatio: evidenceCheck.matchRatio,
              occurrences: evidenceCheck.occurrences,
              verdict: bcd ? "strong" : weakEvidence ? "weak" : evidenceCheck.ok ? "strong" : "weak",
            },
          };
          // Envelope keeps evidence.ok available on cache hits — a bare string
          // cache silently dropped the whole structuredContent block.
          docCache.set(cacheKey, JSON.stringify({ text: response, structuredContent }));

          return { content: [{ type: "text", text: response }], structuredContent };
        }, TIMEOUT_RESPONSE);
      });
    },
  );
}
