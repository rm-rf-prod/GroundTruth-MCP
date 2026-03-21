import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { fetchViaJina } from "../services/fetcher.js";
import { extractRelevantContent } from "../utils/extract.js";
import { sanitizeContent } from "../utils/sanitize.js";
import { isExtractionAttempt, withNotice, EXTRACTION_REFUSAL } from "../utils/guard.js";
import { docCache } from "../services/cache.js";
import { findTopicUrls } from "./search.js";
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
      description: `Check browser, Node.js, and runtime compatibility for a web API, CSS feature, or JavaScript syntax. Fetches live data from MDN Web Docs and caniuse.com.`,
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
      const cacheKey = `compat:${feature}:${envFilter}`;
      const cached = docCache.get(cacheKey);
      if (typeof cached === "string") {
        return { content: [{ type: "text", text: cached }] };
      }

      const featureEncoded = encodeURIComponent(feature);
      const results: string[] = [];
      const searchTopic = envFilter
        ? `${feature} ${envFilter} compatibility`
        : `${feature} browser support compatibility`;

      // 1. Check topic map for a direct MDN URL
      const topicMatches = findTopicUrls(feature);
      const mdnUrl =
        topicMatches
          .flatMap((t) => t.urls)
          .find((u) => u.includes("mozilla.org")) ??
        `https://developer.mozilla.org/en-US/search?q=${featureEncoded}+browser+compatibility`;

      const mdnContent = await fetchViaJina(mdnUrl);
      if (mdnContent && mdnContent.length > 200) {
        const safe = sanitizeContent(mdnContent);
        const { text } = extractRelevantContent(safe, searchTopic, Math.floor(tokens * 0.6));
        if (text.length > 100) results.push(`## MDN Web Docs\n\n${text}`);
      }

      // 2. caniuse.com — especially useful for CSS and browser-specific APIs
      const isCssOrBrowser = /css|html|browser|webkit|layout|paint|grid|flex|animation|transition/i.test(
        feature,
      );
      if (results.length === 0 || isCssOrBrowser) {
        const caniuseContent = await fetchViaJina(`https://caniuse.com/?search=${featureEncoded}`);
        if (caniuseContent && caniuseContent.length > 200) {
          const safe = sanitizeContent(caniuseContent);
          const { text } = extractRelevantContent(safe, `${feature} browser support`, Math.floor(tokens * 0.4));
          if (text.length > 100) results.push(`## Can I Use\n\n${text}`);
        }
      }

      if (results.length === 0) {
        const text = withNotice(
          `No compatibility data found for **${feature}**.\n\nCheck manually:\n- https://developer.mozilla.org/en-US/search?q=${featureEncoded}\n- https://caniuse.com/?search=${featureEncoded}`,
        );
        return { content: [{ type: "text", text }] };
      }

      const header = [
        `# Browser Compatibility: ${feature}`,
        envFilter ? `Focused on: ${envFilter}` : "",
        "",
      ]
        .filter(Boolean)
        .join("\n");

      const response = withNotice(`${header}\n\n${results.join("\n\n---\n\n")}`);
      docCache.set(cacheKey, response);

      return {
        content: [{ type: "text", text: response }],
        structuredContent: {
          feature,
          environments: environments ?? [],
          sources: results.map((r) => r.split("\n")[0]?.replace(/^#+\s*/, "") ?? ""),
        },
      };
    },
  );
}
