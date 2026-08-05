import { withNotice } from "../utils/guard.js";
import { lookupById, lookupByAlias } from "../sources/registry.js";
import { buildIndex } from "../services/snippets/build-index.js";
import { rankSnippets, renderSnippets } from "../utils/snippet-extract.js";

export interface ExamplesResponse {
  [key: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: Record<string, unknown>;
}

/**
 * GitHub code search is auth-only — without GT_GITHUB_TOKEN it always returns
 * 401. Instead of dead-ending, serve ranked code examples from the library's
 * official documentation and say so.
 */
async function docsExamples(
  library: string,
  pattern: string | undefined,
  maxResults: number,
  reason: string,
): Promise<{ text: string; sourceUrl: string; count: number } | null> {
  const entry = lookupById(library) ?? lookupByAlias(library);
  if (!entry) return null;
  const index = await buildIndex(
    entry.id,
    undefined,
    entry.docsUrl,
    entry.llmsTxtUrl,
    entry.llmsFullTxtUrl,
    entry.githubUrl,
    pattern ?? "",
  ).catch(() => null);
  if (!index || index.snippets.length === 0) return null;
  const ranked = rankSnippets(index.snippets, pattern ?? "", undefined, maxResults);
  if (ranked.length === 0) return null;
  const text = withNotice(
    [
      `# Code Examples: ${library}${pattern ? ` — ${pattern}` : ""}`,
      `> ${reason} Showing examples from the official documentation instead.`,
      `> Source: ${index.sourceUrl}`,
      "",
      "---",
      "",
      renderSnippets(ranked),
    ].join("\n"),
  );
  return { text, sourceUrl: index.sourceUrl, count: ranked.length };
}

/** Documentation-derived examples, or an actionable message when there are none. */
export async function docsFallbackResponse(params: {
  library: string;
  pattern: string | undefined;
  language: string | undefined;
  maxResults: number;
  reason: string;
  /** Message when the docs fallback also came up empty. Defaults to the generic hint. */
  emptyText?: string;
}): Promise<ExamplesResponse> {
  const { library, pattern, language, maxResults, reason, emptyText } = params;
  const fallback = await docsExamples(library, pattern, maxResults, reason).catch(() => null);
  if (fallback) {
    return {
      content: [{ type: "text", text: fallback.text }],
      structuredContent: {
        library,
        pattern,
        language,
        totalCount: fallback.count,
        source: "official-docs-fallback",
        sourceUrl: fallback.sourceUrl,
      },
    };
  }
  return {
    content: [{
      type: "text",
      text: emptyText
        ?? `${reason} No documentation-based examples found either — try gt_snippets with a registry libraryId, or set GT_GITHUB_TOKEN.`,
    }],
  };
}
