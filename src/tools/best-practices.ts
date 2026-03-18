import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { lookupById, lookupByAlias } from "../sources/registry.js";
import { fetchDocs, fetchGitHubContent, fetchViaJina } from "../services/fetcher.js";
import { extractRelevantContent } from "../utils/extract.js";
import { sanitizeContent } from "../utils/sanitize.js";
import { DEFAULT_TOKEN_LIMIT } from "../constants.js";

const InputSchema = z.object({
  libraryId: z
    .string()
    .min(1)
    .max(300)
    .describe("Library ID (from ws_resolve_library) or library name like 'nextjs', 'react'"),
  topic: z
    .string()
    .max(300)
    .optional()
    .describe(
      "Specific area: 'performance', 'security', 'testing', 'deployment', 'migration', 'patterns', 'v4 migration'. Leave empty for general best practices.",
    ),
  tokens: z
    .number()
    .int()
    .min(1000)
    .max(DEFAULT_TOKEN_LIMIT)
    .default(DEFAULT_TOKEN_LIMIT)
    .describe("Max tokens to return"),
});

// Known best practices / guide URLs per library
const BEST_PRACTICES_URLS: Record<string, string[]> = {
  "vercel/next.js": [
    "https://nextjs.org/docs/app/building-your-application/deploying",
    "https://nextjs.org/docs/app/building-your-application/rendering",
    "https://nextjs.org/docs/app/building-your-application/caching",
    "https://nextjs.org/docs/app/building-your-application/optimizing",
  ],
  "facebook/react": [
    "https://react.dev/learn/thinking-in-react",
    "https://react.dev/learn/escape-hatches",
    "https://react.dev/reference/react",
  ],
  "tailwindlabs/tailwindcss": [
    "https://tailwindcss.com/docs/utility-first",
    "https://tailwindcss.com/docs/reusing-styles",
  ],
  "vercel/ai": [
    "https://sdk.vercel.ai/docs/ai-sdk-core/overview",
    "https://sdk.vercel.ai/docs/ai-sdk-ui/overview",
    "https://sdk.vercel.ai/docs/ai-sdk-core/agents",
  ],
  "supabase/supabase": [
    "https://supabase.com/docs/guides/database/postgres/row-level-security",
    "https://supabase.com/docs/guides/auth/overview",
    "https://supabase.com/docs/guides/performance",
  ],
  "drizzle-team/drizzle-orm": [
    "https://orm.drizzle.team/docs/guides",
    "https://orm.drizzle.team/docs/migrations",
    "https://orm.drizzle.team/docs/performance",
  ],
  "colinhacks/zod": [
    "https://zod.dev/basics",
    "https://zod.dev/parsing",
  ],
  "withastro/astro": [
    "https://docs.astro.build/en/guides/best-practices/",
    "https://docs.astro.build/en/guides/performance/",
  ],
  "microsoft/playwright": [
    "https://playwright.dev/docs/best-practices",
    "https://playwright.dev/docs/test-assertions",
  ],
  "tiangolo/fastapi": [
    "https://fastapi.tiangolo.com/tutorial/",
    "https://fastapi.tiangolo.com/advanced/",
    "https://fastapi.tiangolo.com/deployment/",
  ],
  "ueberdosis/tiptap": ["https://tiptap.dev/docs/editor/getting-started/overview"],
  "emilkowalski/sonner": ["https://sonner.emilkowal.ski"],
  "resend/resend-node": ["https://resend.com/docs/introduction"],
  "darkroomstudio/lenis": ["https://lenis.darkroom.engineering"],
};

// Common best-practices path patterns to try for any library
const GENERIC_BP_SUFFIXES = [
  "/docs/best-practices",
  "/docs/guide",
  "/docs/guides",
  "/docs/patterns",
  "/docs/tips",
  "/docs/migration",
  "/guide",
  "/guides",
];

async function fetchBestPracticesContent(
  libraryId: string,
  docsUrl: string,
  llmsTxtUrl: string | undefined,
  llmsFullTxtUrl: string | undefined,
  githubUrl: string | undefined,
  topic: string,
  tokens: number,
): Promise<{ text: string; sourceUrl: string; truncated: boolean }> {
  // 1. Check known best-practices URLs for this library
  const knownUrls = BEST_PRACTICES_URLS[libraryId];
  if (knownUrls && knownUrls.length > 0) {
    const targetUrls = topic
      ? knownUrls.filter((u) => u.toLowerCase().includes(topic.toLowerCase())).concat(knownUrls)
      : knownUrls;

    for (const url of targetUrls.slice(0, 3)) {
      const raw = await fetchViaJina(url);
      if (raw && raw.length > 300) {
        const safe = sanitizeContent(raw);
        const { text: extracted, truncated } = extractRelevantContent(
          safe,
          topic || "best practices patterns guide",
          tokens,
        );
        return { text: extracted, sourceUrl: url, truncated };
      }
    }
  }

  // 2. Try generic best-practices paths
  const origin = (() => {
    try {
      return new URL(docsUrl).origin;
    } catch {
      return null;
    }
  })();

  if (origin) {
    for (const suffix of GENERIC_BP_SUFFIXES) {
      const url = `${origin}${suffix}`;
      const raw = await fetchViaJina(url);
      if (raw && raw.length > 300) {
        const safe = sanitizeContent(raw);
        const { text: extracted, truncated } = extractRelevantContent(
          safe,
          topic || "best practices patterns guide",
          tokens,
        );
        return { text: extracted, sourceUrl: url, truncated };
      }
    }
  }

  // 3. Fall back to main docs with topic = "best practices"
  try {
    const result = await fetchDocs(docsUrl, llmsTxtUrl, llmsFullTxtUrl);
    const safe = sanitizeContent(result.content);
    const enrichedTopic = topic
      ? `${topic} best practices patterns guide`
      : "best practices patterns guide tips";
    const { text: extracted, truncated } = extractRelevantContent(safe, enrichedTopic, tokens);
    return { text: extracted, sourceUrl: result.url, truncated };
  } catch {
    // ignore
  }

  // 4. GitHub CHANGELOG / CONTRIBUTING
  if (githubUrl) {
    for (const path of ["CONTRIBUTING.md", "docs/patterns.md", "docs/best-practices.md"]) {
      const ghResult = await fetchGitHubContent(githubUrl, path);
      if (ghResult) {
        const safe = sanitizeContent(ghResult.content);
        const { text: extracted, truncated } = extractRelevantContent(safe, topic, tokens);
        return { text: extracted, sourceUrl: ghResult.url, truncated };
      }
    }
  }

  return {
    text: `Could not find specific best practices for "${libraryId}". Try ws_get_docs with topic="best practices patterns".`,
    sourceUrl: docsUrl,
    truncated: false,
  };
}

export function registerBestPracticesTool(server: McpServer): void {
  server.registerTool(
    "ws_best_practices",
    {
      title: "Get Best Practices",
      description: `Fetch latest best practices, patterns, and guidelines for any library or framework.

Specifically targets best-practices pages, guides, migration docs, and performance tips —
not generic reference docs.

Use this when you want:
- "What's the right way to do X in Y?"
- "Latest patterns for authentication in Next.js"
- "Performance best practices for React"
- "Migrate from v3 to v4"
- "Security best practices for Supabase"

Examples:
- ws_best_practices({ libraryId: "vercel/next.js", topic: "caching and performance" })
- ws_best_practices({ libraryId: "supabase/supabase", topic: "row level security" })
- ws_best_practices({ libraryId: "vercel/ai", topic: "streaming agents" })
- ws_best_practices({ libraryId: "react" }) — general best practices`,
      inputSchema: InputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ libraryId, topic = "", tokens }) => {
      // Resolve library — accept both IDs and aliases
      const entry = lookupById(libraryId) ?? lookupByAlias(libraryId);

      if (!entry) {
        return {
          content: [
            {
              type: "text",
              text: `Library "${libraryId}" not found in registry. Call ws_resolve_library first to get a valid ID, then pass it here.`,
            },
          ],
        };
      }

      const { text, sourceUrl, truncated } = await fetchBestPracticesContent(
        entry.id,
        entry.docsUrl,
        entry.llmsTxtUrl,
        entry.llmsFullTxtUrl,
        entry.githubUrl,
        topic,
        tokens,
      );

      const header = [
        `# ${entry.name} — Best Practices`,
        topic ? `> Topic: ${topic}` : "",
        `> Source: ${sourceUrl}`,
        truncated ? "> Note: Response truncated. Use a more specific topic or increase tokens." : "",
        "",
        "---",
        "",
      ]
        .filter(Boolean)
        .join("\n");

      return {
        content: [{ type: "text", text: header + text }],
        structuredContent: {
          libraryId: entry.id,
          displayName: entry.name,
          topic,
          sourceUrl,
          truncated,
          content: text,
        },
      };
    },
  );
}
