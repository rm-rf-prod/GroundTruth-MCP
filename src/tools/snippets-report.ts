import type { Snippet, SnippetIndex } from "../types.js";
import { withNotice } from "../utils/guard.js";
import { renderSnippets } from "../utils/snippet-extract.js";

export interface SnippetResponse {
  [key: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: Record<string, unknown>;
}

export function renderNoIndex(displayName: string): SnippetResponse {
  return {
    content: [{
      type: "text",
      text: [
        `No snippets indexed for "${displayName}".`,
        "",
        "**What to try next:**",
        "- Run gt_resolve_library to confirm the library ID",
        "- Try gt_examples for real-world usage examples from GitHub repositories",
        "- Try gt_get_docs for prose-style content",
        "- Re-run with refresh:true if the cache may be stale",
      ].join("\n"),
    }],
  };
}

/**
 * Topic matched nothing in a non-empty index: say so explicitly and show what IS
 * available instead of returning an empty shell.
 */
export function renderNoTopicMatch(params: {
  index: SnippetIndex;
  displayName: string;
  library: string;
  topic: string;
  version: string | undefined;
  language: string | undefined;
}): SnippetResponse {
  const { index, displayName, library, topic, version, language } = params;
  const available = index.snippets
    .slice(0, 10)
    .map((s) => `- ${s.title}${s.language ? ` (${s.language})` : ""}`)
    .join("\n");

  return {
    content: [{
      type: "text",
      text: [
        `# ${displayName} — no snippets match "${topic}"${language ? ` in ${language}` : ""}`,
        "",
        `The snippet index for ${displayName} (${index.snippets.length} snippets from ${index.sourceUrl}) contains no code matching that topic. Closest available snippets:`,
        "",
        available,
        "",
        "**What to try next:**",
        "- Re-run with one of the topics listed above, or without a topic to see everything",
        `- Try gt_get_docs with topic "${topic}" for prose documentation`,
        "- Try gt_examples for real-world GitHub usage of this pattern",
      ].join("\n"),
    }],
    structuredContent: {
      library,
      displayName,
      topic,
      version: version ?? null,
      language: language ?? null,
      sourceUrl: index.sourceUrl,
      totalSnippets: 0,
      indexedSnippets: index.snippets.length,
      snippets: [],
    },
  };
}

export function renderSnippetResult(params: {
  snippets: Snippet[];
  library: string;
  displayName: string;
  topic: string;
  version: string | undefined;
  language: string | undefined;
  sourceUrl: string;
  builtAt: string;
  fromCache: boolean;
}): SnippetResponse {
  const { snippets, library, displayName, topic, version, language, sourceUrl, builtAt, fromCache } = params;

  const header = [
    `# ${displayName} Snippets`,
    topic ? `> Topic: ${topic}` : "",
    version ? `> Version: ${version}` : "",
    language ? `> Language: ${language}` : "",
    `> Source: ${sourceUrl}`,
    `> Indexed: ${builtAt}${fromCache ? " (cache)" : ""}`,
    "",
    "---",
    "",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    content: [{ type: "text", text: withNotice(header + renderSnippets(snippets)) }],
    structuredContent: {
      library,
      displayName,
      topic,
      version: version ?? null,
      language: language ?? null,
      sourceUrl,
      builtAt,
      fromCache,
      totalSnippets: snippets.length,
      snippets: snippets.map((s) => ({
        id: s.id,
        title: s.title,
        description: s.description,
        language: s.language,
        code: s.code,
        source: s.source,
        score: s.score,
      })),
    },
  };
}
