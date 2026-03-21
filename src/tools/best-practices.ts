import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { lookupById, lookupByAlias } from "../sources/registry.js";
import { fetchDocs, fetchGitHubContent, fetchViaJina, fetchGitHubExamples } from "../services/fetcher.js";
import { deepFetchForTopic } from "../services/deep-fetch.js";
import { extractRelevantContent } from "../utils/extract.js";
import { isExtractionAttempt, withNotice, EXTRACTION_REFUSAL } from "../utils/guard.js";
import { sanitizeContent } from "../utils/sanitize.js";
import { computeQualityScore } from "../utils/quality.js";
import { DEFAULT_TOKEN_LIMIT, MAX_TOKEN_LIMIT } from "../constants.js";

const InputSchema = z.object({
  libraryId: z
    .string()
    .min(1)
    .max(300)
    .describe("Library ID (from gt_resolve_library) or library name like 'nextjs', 'react'"),
  topic: z
    .string()
    .max(300)
    .optional()
    .describe(
      "Specific area: 'performance', 'security', 'testing', 'deployment', 'migration', 'patterns', 'v4 migration'. Leave empty for general best practices.",
    ),
  version: z
    .string()
    .max(50)
    .optional()
    .describe("Version to scope results to, e.g. '14', '3.0.0'. Focuses extraction on version-specific patterns."),
  tokens: z
    .number()
    .int()
    .min(1000)
    .max(MAX_TOKEN_LIMIT)
    .default(DEFAULT_TOKEN_LIMIT)
    .describe("Max tokens to return"),
});

// Known best practices / guide URLs per library — 363+ entries
const BEST_PRACTICES_URLS: Record<string, string[]> = {
  // ─── JavaScript / TypeScript Frameworks ─────────────────────────────────
  "vercel/next.js": [
    "https://nextjs.org/docs/app/building-your-application/rendering",
    "https://nextjs.org/docs/app/building-your-application/caching",
    "https://nextjs.org/docs/app/building-your-application/deploying",
    "https://nextjs.org/docs/app/building-your-application/optimizing",
    "https://nextjs.org/docs/app/building-your-application/authentication",
  ],
  "facebook/react": [
    "https://react.dev/learn/thinking-in-react",
    "https://react.dev/learn/escape-hatches",
    "https://react.dev/reference/rules",
    "https://react.dev/learn/managing-state",
    "https://react.dev/learn/you-might-not-need-an-effect",
  ],
  "vuejs/vue": [
    "https://vuejs.org/guide/best-practices/performance",
    "https://vuejs.org/guide/best-practices/security",
    "https://vuejs.org/guide/best-practices/accessibility",
    "https://vuejs.org/guide/best-practices/production-deployment",
  ],
  "sveltejs/svelte": [
    "https://svelte.dev/docs/kit/performance",
    "https://svelte.dev/docs/svelte/best-practices",
  ],
  "honojs/hono": [
    "https://hono.dev/docs/guides/best-practices",
    "https://hono.dev/docs/guides/middleware",
    "https://hono.dev/docs/guides/testing",
  ],
  "expressjs/express": [
    "https://expressjs.com/en/advanced/best-practice-performance.html",
    "https://expressjs.com/en/advanced/best-practice-security.html",
  ],
  "nestjs/nest": [
    "https://docs.nestjs.com/techniques/performance",
    "https://docs.nestjs.com/security/authentication",
    "https://docs.nestjs.com/techniques/caching",
    "https://docs.nestjs.com/fundamentals/testing",
  ],
  "elysiajs/elysia": [
    "https://elysiajs.com/patterns/best-practices.html",
    "https://elysiajs.com/essential/best-practice.html",
  ],
  "unjs/nitro": [
    "https://nitro.build/guide",
    "https://nitro.build/deploy",
  ],
  "trpc/trpc": [
    "https://trpc.io/docs/server/procedures",
    "https://trpc.io/docs/client/nextjs",
    "https://trpc.io/docs/server/middlewares",
  ],

  // ─── CSS / Styling ───────────────────────────────────────────────────────
  "tailwindlabs/tailwindcss": [
    "https://tailwindcss.com/docs/utility-first",
    "https://tailwindcss.com/docs/reusing-styles",
    "https://tailwindcss.com/docs/optimizing-for-production",
  ],
  "shadcn/ui": [
    "https://ui.shadcn.com/docs/installation",
    "https://ui.shadcn.com/docs/theming",
    "https://ui.shadcn.com/docs/dark-mode",
  ],
  "radix-ui/primitives": [
    "https://www.radix-ui.com/primitives/docs/overview/accessibility",
    "https://www.radix-ui.com/primitives/docs/overview/getting-started",
  ],
  "ariakit/ariakit": ["https://ariakit.org/guide/accessibility"],
  "chakra-ui/chakra-ui": [
    "https://v2.chakra-ui.com/docs/styled-system/customize-theme",
    "https://v2.chakra-ui.com/docs/components",
  ],
  "windicss/windicss": ["https://windicss.org/guide/"],
  "pandacss/panda": [
    "https://panda-css.com/docs/overview/getting-started",
    "https://panda-css.com/docs/concepts/writing-styles",
  ],

  // ─── Database / ORM ──────────────────────────────────────────────────────
  "drizzle-team/drizzle-orm": [
    "https://orm.drizzle.team/docs/guides",
    "https://orm.drizzle.team/docs/migrations",
    "https://orm.drizzle.team/docs/performance",
    "https://orm.drizzle.team/docs/rls",
  ],
  "prisma/prisma": [
    "https://www.prisma.io/docs/guides/performance-and-optimization",
    "https://www.prisma.io/docs/guides/database/best-practices",
    "https://www.prisma.io/docs/guides/testing",
  ],
  "supabase/supabase": [
    "https://supabase.com/docs/guides/database/postgres/row-level-security",
    "https://supabase.com/docs/guides/auth/overview",
    "https://supabase.com/docs/guides/performance",
    "https://supabase.com/docs/guides/database/postgres/best-practices",
    "https://supabase.com/docs/guides/realtime",
    "https://supabase.com/docs/guides/realtime/presence",
    "https://supabase.com/docs/guides/realtime/broadcast",
    "https://supabase.com/docs/guides/storage",
    "https://supabase.com/docs/guides/functions",
    "https://supabase.com/docs/guides/auth/server-side/nextjs",
  ],
  "neondatabase/neon": [
    "https://neon.tech/docs/guides/branching-intro",
    "https://neon.tech/docs/introduction/connection-pooling",
  ],
  "turso-tech/libsql": [
    "https://docs.turso.tech/sdk/ts/guides",
    "https://docs.turso.tech/features/embedded-replicas",
  ],
  "typeorm/typeorm": [
    "https://typeorm.io/connection",
    "https://typeorm.io/migrations",
    "https://typeorm.io/performance-tips",
  ],
  "Automattic/mongoose": [
    "https://mongoosejs.com/docs/guide.html",
    "https://mongoosejs.com/docs/best_practices.html",
    "https://mongoosejs.com/docs/indexes.html",
  ],
  "mongoose/mongoose": [
    "https://mongoosejs.com/docs/guide.html",
    "https://mongoosejs.com/docs/best_practices.html",
    "https://mongoosejs.com/docs/indexes.html",
    "https://mongoosejs.com/docs/middleware.html",
  ],
  "knex/knex": [
    "https://knexjs.org/guide/",
    "https://knexjs.org/guide/migrations.html",
  ],
  "kysely-org/kysely": [
    "https://kysely.dev/docs/getting-started",
    "https://kysely.dev/docs/migrations",
  ],
  "electric-sql/electric": [
    "https://electric-sql.com/docs/intro/quickstart",
    "https://electric-sql.com/docs/guides/sync",
  ],
  "redis/node-redis": [
    "https://redis.io/docs/latest/develop/connect/clients/nodejs/",
    "https://redis.io/docs/latest/develop/use/patterns/",
  ],

  // ─── Validation / Schema ─────────────────────────────────────────────────
  "colinhacks/zod": [
    "https://zod.dev/basics",
    "https://zod.dev/parsing",
    "https://zod.dev/error-handling",
  ],
  "fabian-hiller/valibot": [
    "https://valibot.dev/guides/introduction/",
    "https://valibot.dev/guides/migrate-from-zod/",
  ],
  "jquense/yup": [
    "https://github.com/jquense/yup#schema-basics",
  ],
  "effect-ts/effect": [
    "https://effect.website/docs/introduction",
    "https://effect.website/docs/error-management/expected-errors",
  ],
  "Effect-TS/effect": [
    "https://effect.website/docs/introduction",
    "https://effect.website/docs/error-management/expected-errors",
    "https://effect.website/docs/concurrency/basic-concurrency",
    "https://effect.website/docs/guides/configuration",
  ],

  // ─── State Management ────────────────────────────────────────────────────
  "pmndrs/zustand": [
    "https://docs.pmnd.rs/zustand/guides/updating-state",
    "https://docs.pmnd.rs/zustand/guides/typescript",
    "https://docs.pmnd.rs/zustand/guides/testing",
  ],
  "pmndrs/jotai": [
    "https://jotai.org/docs/guides/typescript",
    "https://jotai.org/docs/guides/testing",
    "https://jotai.org/docs/guides/performance",
  ],
  "TanStack/query": [
    "https://tanstack.com/query/latest/docs/framework/react/guides/important-defaults",
    "https://tanstack.com/query/latest/docs/framework/react/guides/caching",
    "https://tanstack.com/query/latest/docs/framework/react/guides/optimistic-updates",
    "https://tanstack.com/query/latest/docs/framework/react/guides/testing",
  ],
  "vercel/swr": [
    "https://swr.vercel.app/docs/getting-started",
    "https://swr.vercel.app/docs/advanced/performance",
    "https://swr.vercel.app/docs/middleware",
  ],
  "reduxjs/redux-toolkit": [
    "https://redux-toolkit.js.org/usage/usage-guide",
    "https://redux-toolkit.js.org/tutorials/typescript",
    "https://redux.js.org/style-guide/",
  ],
  "pmndrs/valtio": [
    "https://valtio.pmnd.rs/docs/how-tos/how-to-use-with-context",
  ],
  "mobxjs/mobx": [
    "https://mobx.js.org/best/pitfalls.html",
    "https://mobx.js.org/guides/react-optimizations.html",
  ],
  "statelyai/xstate": [
    "https://stately.ai/docs/xstate",
    "https://stately.ai/docs/typescript",
  ],
  "vuejs/pinia": [
    "https://pinia.vuejs.org/core-concepts/",
    "https://pinia.vuejs.org/cookbook/testing.html",
  ],

  // ─── Testing ─────────────────────────────────────────────────────────────
  "vitest-dev/vitest": [
    "https://vitest.dev/guide/",
    "https://vitest.dev/guide/mocking",
    "https://vitest.dev/guide/snapshot",
    "https://vitest.dev/guide/coverage",
  ],
  "microsoft/playwright": [
    "https://playwright.dev/docs/best-practices",
    "https://playwright.dev/docs/test-assertions",
    "https://playwright.dev/docs/locators",
    "https://playwright.dev/docs/auth",
  ],
  "jestjs/jest": [
    "https://jestjs.io/docs/getting-started",
    "https://jestjs.io/docs/configuration",
    "https://jestjs.io/docs/mock-functions",
  ],
  "testing-library/testing-library": [
    "https://testing-library.com/docs/guiding-principles",
    "https://testing-library.com/docs/queries/about",
  ],
  "cypress-io/cypress": [
    "https://docs.cypress.io/guides/core-concepts/best-practices",
    "https://docs.cypress.io/guides/guides/network-requests",
  ],
  "mswjs/msw": [
    "https://mswjs.io/docs/best-practices/",
    "https://mswjs.io/docs/concepts/request-handler",
  ],

  // ─── Build Tools ─────────────────────────────────────────────────────────
  "vitejs/vite": [
    "https://vite.dev/guide/features",
    "https://vite.dev/guide/performance",
    "https://vite.dev/guide/build",
    "https://vite.dev/guide/ssr",
  ],
  "biomejs/biome": [
    "https://biomejs.dev/guides/getting-started/",
    "https://biomejs.dev/guides/integrate-in-vcs/",
    "https://biomejs.dev/linter/rules/",
  ],
  "vercel/turbo": [
    "https://turbo.build/repo/docs/core-concepts/caching",
    "https://turbo.build/repo/docs/core-concepts/monorepos",
    "https://turbo.build/repo/docs/reference/configuration",
  ],
  "nrwl/nx": [
    "https://nx.dev/concepts/mental-model",
    "https://nx.dev/recipes/tips-n-tricks/monorepo-nx-enterprise",
  ],
  "rollup/rollup": [
    "https://rollupjs.org/guide/en/#tree-shaking",
    "https://rollupjs.org/guide/en/#big-list-of-options",
  ],
  "webpack/webpack": [
    "https://webpack.js.org/guides/code-splitting/",
    "https://webpack.js.org/guides/tree-shaking/",
    "https://webpack.js.org/guides/caching/",
  ],
  "pnpm/pnpm": [
    "https://pnpm.io/motivation",
    "https://pnpm.io/workspaces",
  ],

  // ─── Runtime ─────────────────────────────────────────────────────────────
  "nicolo-ribaudo/node": [
    "https://nodejs.org/en/docs/guides/",
    "https://nodejs.org/en/learn/getting-started/introduction-to-nodejs",
  ],
  "oven-sh/bun": [
    "https://bun.sh/docs",
    "https://bun.sh/guides",
  ],
  "denoland/deno": [
    "https://docs.deno.com/runtime/fundamentals/",
    "https://docs.deno.com/runtime/contributing/style_guide/",
  ],

  // ─── AI / ML (JavaScript) ────────────────────────────────────────────────
  "vercel/ai": [
    "https://sdk.vercel.ai/docs/ai-sdk-core/overview",
    "https://sdk.vercel.ai/docs/ai-sdk-ui/overview",
    "https://sdk.vercel.ai/docs/ai-sdk-core/agents",
    "https://sdk.vercel.ai/docs/ai-sdk-core/tools-and-tool-calling",
    "https://sdk.vercel.ai/docs/ai-sdk-core/generating-structured-data",
  ],
  "anthropics/anthropic-sdk-js": [
    "https://docs.anthropic.com/en/docs/build-with-claude/overview",
    "https://docs.anthropic.com/en/docs/build-with-claude/tool-use",
    "https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/overview",
  ],
  "anthropics/anthropic-sdk-node": [
    "https://docs.anthropic.com/en/docs/build-with-claude/overview",
    "https://docs.anthropic.com/en/docs/build-with-claude/tool-use",
    "https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/overview",
    "https://docs.anthropic.com/en/docs/build-with-claude/streaming",
    "https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching",
  ],
  "anthropics/anthropic-sdk-python": [
    "https://docs.anthropic.com/en/docs/build-with-claude/overview",
    "https://docs.anthropic.com/en/docs/build-with-claude/tool-use",
    "https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/overview",
    "https://docs.anthropic.com/en/docs/build-with-claude/streaming",
  ],
  "anthropics/anthropic-api": [
    "https://docs.anthropic.com/en/docs/build-with-claude/overview",
    "https://docs.anthropic.com/en/docs/build-with-claude/tool-use",
    "https://docs.anthropic.com/en/docs/build-with-claude/vision",
    "https://docs.anthropic.com/en/docs/build-with-claude/extended-thinking",
    "https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching",
  ],
  "openai/openai-node": [
    "https://platform.openai.com/docs/guides/text-generation",
    "https://platform.openai.com/docs/guides/function-calling",
    "https://platform.openai.com/docs/guides/structured-outputs",
  ],
  "langchain-ai/langchainjs": [
    "https://js.langchain.com/docs/concepts/",
    "https://js.langchain.com/docs/how_to/",
  ],
  "run-llama/LlamaIndexTS": [
    "https://ts.llamaindex.ai/docs/llamaindex/getting_started/installation",
  ],
  "xenova/transformers.js": [
    "https://huggingface.co/docs/transformers.js/index",
    "https://huggingface.co/docs/transformers.js/guides/node-esm",
  ],
  "ollama/ollama-js": [
    "https://github.com/ollama/ollama-js#usage",
  ],
  "assistant-ui/assistant-ui": [
    "https://www.assistant-ui.com/docs/getting-started",
    "https://www.assistant-ui.com/docs/api-reference",
  ],

  // ─── AI / ML (Python) ────────────────────────────────────────────────────
  "langchain-ai/langchain": [
    "https://python.langchain.com/docs/concepts/",
    "https://python.langchain.com/docs/how_to/",
    "https://python.langchain.com/docs/tutorials/rag/",
  ],
  "run-llama/llama_index": [
    "https://docs.llamaindex.ai/en/stable/getting_started/concepts/",
    "https://docs.llamaindex.ai/en/stable/examples/",
  ],
  "crewAIInc/crewAI": [
    "https://docs.crewai.com/introduction",
    "https://docs.crewai.com/concepts/agents",
    "https://docs.crewai.com/concepts/tasks",
  ],
  "langchain-ai/langgraph": [
    "https://langchain-ai.github.io/langgraph/concepts/",
    "https://langchain-ai.github.io/langgraph/how-tos/",
  ],
  "huggingface/transformers": [
    "https://huggingface.co/docs/transformers/main/en/quicktour",
    "https://huggingface.co/docs/transformers/main/en/performance",
    "https://huggingface.co/docs/transformers/main/en/training",
  ],

  // ─── Vector Databases ────────────────────────────────────────────────────
  "pinecone-io/pinecone": [
    "https://docs.pinecone.io/guides/get-started/overview",
    "https://docs.pinecone.io/guides/indexes/understanding-indexes",
    "https://docs.pinecone.io/guides/data/upsert-data",
  ],
  "qdrant/qdrant": [
    "https://qdrant.tech/documentation/guides/",
    "https://qdrant.tech/documentation/concepts/",
  ],

  // ─── Auth ────────────────────────────────────────────────────────────────
  "clerkinc/javascript": [
    "https://clerk.com/docs/quickstarts/nextjs",
    "https://clerk.com/docs/references/nextjs/auth",
    "https://clerk.com/docs/organizations/overview",
  ],
  "nextauthjs/next-auth": [
    "https://authjs.dev/getting-started",
    "https://authjs.dev/getting-started/providers",
    "https://authjs.dev/concepts/session-management",
    "https://authjs.dev/getting-started/deployment",
  ],
  "better-auth/better-auth": [
    "https://www.better-auth.com/docs/installation",
    "https://www.better-auth.com/docs/authentication/email-password",
  ],
  "pilcrowonpaper/lucia": [
    "https://lucia-auth.com/tutorials/",
    "https://lucia-auth.com/guides/validate-session-cookies/",
  ],
  "jaredhanson/passport": [
    "https://www.passportjs.org/tutorials/password/",
    "https://www.passportjs.org/concepts/authentication/",
  ],

  // ─── Mobile / React Native ───────────────────────────────────────────────
  "expo/expo": [
    "https://docs.expo.dev/develop/development-builds/introduction/",
    "https://docs.expo.dev/guides/file-based-routing/",
    "https://docs.expo.dev/guides/using-eslint/",
    "https://docs.expo.dev/eas/",
  ],
  "facebook/react-native": [
    "https://reactnative.dev/docs/performance",
    "https://reactnative.dev/docs/style",
    "https://reactnative.dev/docs/testing-overview",
    "https://reactnative.dev/architecture/overview",
  ],
  "expo/router": [
    "https://docs.expo.dev/router/introduction/",
    "https://docs.expo.dev/router/layouts/",
    "https://docs.expo.dev/router/navigating-pages/",
  ],
  "react-navigation/react-navigation": [
    "https://reactnavigation.org/docs/getting-started",
    "https://reactnavigation.org/docs/auth-flow",
    "https://reactnavigation.org/docs/performance",
  ],
  "marceloterreiro/flash-list": [
    "https://shopify.github.io/flash-list/docs/",
    "https://shopify.github.io/flash-list/docs/performance-troubleshooting",
  ],
  "software-mansion/react-native-reanimated": [
    "https://docs.swmansion.com/react-native-reanimated/docs/",
    "https://docs.swmansion.com/react-native-reanimated/docs/fundamentals/getting-started/",
  ],
  "mrousavy/react-native-mmkv": [
    "https://github.com/mrousavy/react-native-mmkv#usage",
  ],
  "shopify/react-native-skia": [
    "https://shopify.github.io/react-native-skia/docs/getting-started/installation",
  ],
  "nativewind/nativewind": [
    "https://www.nativewind.dev/getting-started/",
    "https://www.nativewind.dev/overview/",
  ],
  "software-mansion/react-native-gesture-handler": [
    "https://docs.swmansion.com/react-native-gesture-handler/docs/",
  ],

  // ─── Python Frameworks ───────────────────────────────────────────────────
  "tiangolo/fastapi": [
    "https://fastapi.tiangolo.com/tutorial/",
    "https://fastapi.tiangolo.com/advanced/",
    "https://fastapi.tiangolo.com/deployment/",
    "https://fastapi.tiangolo.com/async/",
  ],
  "django/django": [
    "https://docs.djangoproject.com/en/stable/topics/security/",
    "https://docs.djangoproject.com/en/stable/topics/performance/",
    "https://docs.djangoproject.com/en/stable/topics/testing/",
    "https://docs.djangoproject.com/en/stable/misc/design-philosophies/",
  ],
  "pallets/flask": [
    "https://flask.palletsprojects.com/en/stable/quickstart/",
    "https://flask.palletsprojects.com/en/stable/patterns/",
    "https://flask.palletsprojects.com/en/stable/deploying/",
  ],
  "pydantic/pydantic": [
    "https://docs.pydantic.dev/latest/concepts/models/",
    "https://docs.pydantic.dev/latest/concepts/validators/",
    "https://docs.pydantic.dev/latest/concepts/performance/",
  ],

  // ─── Go Frameworks ───────────────────────────────────────────────────────
  "gin-gonic/gin": [
    "https://gin-gonic.com/docs/introduction/",
    "https://gin-gonic.com/docs/examples/",
  ],
  "gofiber/fiber": [
    "https://docs.gofiber.io/",
    "https://docs.gofiber.io/guide/",
  ],
  "go-gorm/gorm": [
    "https://gorm.io/docs/",
    "https://gorm.io/docs/performance.html",
  ],
  "go-chi/chi": [
    "https://go-chi.io/#/pages/getting_started",
  ],

  // ─── Rust Frameworks ─────────────────────────────────────────────────────
  "tokio-rs/axum": [
    "https://docs.rs/axum/latest/axum/",
    "https://github.com/tokio-rs/axum/tree/main/examples",
  ],
  "actix/actix-web": [
    "https://actix.rs/docs/",
    "https://actix.rs/docs/getting-started",
  ],
  "launchbadge/sqlx": [
    "https://docs.rs/sqlx/latest/sqlx/",
    "https://github.com/launchbadge/sqlx/tree/main/examples",
  ],
  "tokio-rs/tokio": [
    "https://tokio.rs/tokio/tutorial",
    "https://tokio.rs/blog/2020-04-preemption",
  ],

  // ─── Content / CMS ───────────────────────────────────────────────────────
  "payloadcms/payload": [
    "https://payloadcms.com/docs/getting-started/what-is-payload",
    "https://payloadcms.com/docs/configuration/overview",
    "https://payloadcms.com/docs/access-control/overview",
  ],
  "strapi/strapi": [
    "https://docs.strapi.io/dev-docs/intro",
    "https://docs.strapi.io/dev-docs/configurations/",
    "https://docs.strapi.io/dev-docs/plugins-development",
  ],
  "contentful/contentful-management.js": [
    "https://www.contentful.com/developers/docs/javascript/getting-started/",
  ],
  "withastro/astro": [
    "https://docs.astro.build/en/guides/best-practices/",
    "https://docs.astro.build/en/guides/performance/",
    "https://docs.astro.build/en/guides/deploy/",
    "https://docs.astro.build/en/guides/server-side-rendering/",
  ],
  "astro-build/astro": [
    "https://docs.astro.build/en/guides/best-practices/",
    "https://docs.astro.build/en/guides/performance/",
    "https://docs.astro.build/en/guides/deploy/",
    "https://docs.astro.build/en/guides/server-side-rendering/",
    "https://docs.astro.build/en/guides/content-collections/",
  ],
  "withastro/starlight": [
    "https://starlight.astro.build/getting-started/",
    "https://starlight.astro.build/guides/customization/",
  ],
  "nuxt/nuxt": [
    "https://nuxt.com/docs/guide/concepts/rendering",
    "https://nuxt.com/docs/guide/best-practices/performance",
    "https://nuxt.com/docs/guide/directory-structure",
  ],
  "nuxt/content": [
    "https://content.nuxt.com/get-started/installation",
    "https://content.nuxt.com/usage/content-directory",
  ],
  "mdx-js/mdx": [
    "https://mdxjs.com/docs/",
    "https://mdxjs.com/guides/",
  ],
  "unifiedjs/unified": [
    "https://unifiedjs.com/learn/guide/using-unified/",
  ],
  "fuma-nama/fumadocs": [
    "https://fumadocs.vercel.app/docs/",
  ],
  "jonschlinkert/gray-matter": [
    "https://github.com/jonschlinkert/gray-matter#usage",
  ],

  // ─── Email ───────────────────────────────────────────────────────────────
  "resend/resend-node": [
    "https://resend.com/docs/introduction",
    "https://resend.com/docs/send-with-react",
    "https://resend.com/docs/idempotency",
  ],
  "nodemailer/nodemailer": [
    "https://nodemailer.com/about/",
    "https://nodemailer.com/smtp/",
    "https://nodemailer.com/transports/",
  ],

  // ─── Payments ────────────────────────────────────────────────────────────
  "stripe/stripe-node": [
    "https://stripe.com/docs/payments/accept-a-payment",
    "https://stripe.com/docs/webhooks",
    "https://stripe.com/docs/security/guide",
    "https://stripe.com/docs/billing/subscriptions/overview",
  ],

  // ─── Rich Text Editors ───────────────────────────────────────────────────
  "ueberdosis/tiptap": [
    "https://tiptap.dev/docs/editor/getting-started/overview",
    "https://tiptap.dev/docs/editor/extensions",
    "https://tiptap.dev/docs/editor/api/commands",
  ],
  "facebook/lexical": [
    "https://lexical.dev/docs/intro",
    "https://lexical.dev/docs/concepts/nodes",
  ],
  "codemirror/codemirror5": [
    "https://codemirror.net/docs/guide/",
  ],
  "ianstormtaylor/slate": [
    "https://docs.slatejs.org/walkthroughs/01-installing-slate",
    "https://docs.slatejs.org/concepts/01-interfaces",
  ],

  // ─── HTTP Clients ────────────────────────────────────────────────────────
  "axios/axios": [
    "https://axios-http.com/docs/intro",
    "https://axios-http.com/docs/interceptors",
    "https://axios-http.com/docs/cancellation",
  ],
  "sindresorhus/ky": [
    "https://github.com/sindresorhus/ky#readme",
  ],

  // ─── Real-time ───────────────────────────────────────────────────────────
  "socketio/socket.io": [
    "https://socket.io/docs/v4/",
    "https://socket.io/docs/v4/performance-tuning/",
    "https://socket.io/docs/v4/rooms/",
  ],
  "partykit/partykit": [
    "https://docs.partykit.io/guides/",
    "https://docs.partykit.io/reference/partyserver-api/",
  ],

  // ─── Observability ───────────────────────────────────────────────────────
  "getsentry/sentry-javascript": [
    "https://docs.sentry.io/platforms/javascript/",
    "https://docs.sentry.io/platforms/javascript/performance/",
    "https://docs.sentry.io/platforms/javascript/session-replay/",
  ],
  "open-telemetry/opentelemetry-js": [
    "https://opentelemetry.io/docs/languages/js/getting-started/nodejs/",
    "https://opentelemetry.io/docs/concepts/observability-primer/",
  ],
  "pinojs/pino": [
    "https://getpino.io/#/docs/web",
    "https://getpino.io/#/docs/asynchronous",
  ],

  // ─── GraphQL ─────────────────────────────────────────────────────────────
  "apollographql/apollo-client": [
    "https://www.apollographql.com/docs/react/",
    "https://www.apollographql.com/docs/react/caching/overview/",
    "https://www.apollographql.com/docs/react/performance/performance/",
  ],
  "FormidableLabs/urql": [
    "https://formidable.com/open-source/urql/docs/",
    "https://formidable.com/open-source/urql/docs/basics/core/",
  ],

  // ─── Cloud ───────────────────────────────────────────────────────────────
  "vercel/vercel": [
    "https://vercel.com/docs/deployments/best-practices",
    "https://vercel.com/docs/security/best-practices",
    "https://vercel.com/docs/functions/configuring-functions/",
  ],
  "cloudflare/workers-sdk": [
    "https://developers.cloudflare.com/workers/get-started/guide/",
    "https://developers.cloudflare.com/workers/best-practices/",
  ],
  "aws/aws-sdk-js-v3": [
    "https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/",
    "https://docs.aws.amazon.com/sdk-for-javascript/v3/developer-guide/getting-started-nodejs.html",
  ],
  "firebase/firebase-js-sdk": [
    "https://firebase.google.com/docs/web/setup",
    "https://firebase.google.com/docs/firestore/best-practices",
    "https://firebase.google.com/docs/auth/web/start",
  ],

  // ─── Utilities ───────────────────────────────────────────────────────────
  "lukeed/clsx": ["https://github.com/lukeed/clsx#readme"],
  "dcastil/tailwind-merge": [
    "https://github.com/dcastil/tailwind-merge#readme",
    "https://github.com/dcastil/tailwind-merge/blob/main/docs/configuration.md",
  ],
  "nicolo-ribaudo/nanoid": ["https://github.com/ai/nanoid#readme"],
  "date-fns/date-fns": [
    "https://date-fns.org/docs/Getting-Started",
    "https://date-fns.org/docs/I18n",
  ],
  "iamkun/dayjs": [
    "https://day.js.org/docs/en/installation/installation",
    "https://day.js.org/docs/en/plugin/plugin",
  ],

  // ─── Motion / Animation ──────────────────────────────────────────────────
  "motiondivision/motion": [
    "https://motion.dev/docs/",
    "https://motion.dev/docs/animate",
  ],
  "pmndrs/react-spring": [
    "https://www.react-spring.dev/docs",
    "https://www.react-spring.dev/docs/getting-started",
  ],
  "darkroomstudio/lenis": ["https://lenis.darkroom.engineering"],

  // ─── Sonner / Toast ──────────────────────────────────────────────────────
  "emilkowalski/sonner": ["https://sonner.emilkowal.ski"],

  // ─── Rust Ecosystem ───────────────────────────────────────────────────────
  "serde-rs/serde": ["https://serde.rs/", "https://serde.rs/derive.html"],
  "seanmonstar/reqwest": ["https://docs.rs/reqwest/latest/reqwest/"],
  "rwf2/Rocket": ["https://rocket.rs/guide/", "https://rocket.rs/guide/configuration/"],

  // ─── Go Ecosystem ────────────────────────────────────────────────────────
  "labstack/echo": ["https://echo.labstack.com/docs/middleware", "https://echo.labstack.com/docs/cookbook"],
  "spf13/cobra": ["https://cobra.dev/", "https://github.com/spf13/cobra/blob/main/site/content/user_guide.md"],

  // ─── Java / Kotlin ────────────────────────────────────────────────────────
  "spring-projects/spring-boot": [
    "https://docs.spring.io/spring-boot/docs/current/reference/html/getting-started.html",
    "https://docs.spring.io/spring-boot/docs/current/reference/html/howto.html",
    "https://docs.spring.io/spring-boot/docs/current/reference/html/actuator.html",
  ],
  "spring-projects/spring-security": [
    "https://docs.spring.io/spring-security/reference/servlet/authentication/index.html",
    "https://docs.spring.io/spring-security/reference/servlet/authorization/index.html",
  ],
  "ktorio/ktor": ["https://ktor.io/docs/server-create-new-project.html", "https://ktor.io/docs/server-auto-reload.html"],

  // ─── DevOps / Infrastructure ──────────────────────────────────────────────
  "ansible/ansible": [
    "https://docs.ansible.com/ansible/latest/playbook_guide/index.html",
    "https://docs.ansible.com/ansible/latest/tips_tricks/index.html",
  ],
  "pulumi/pulumi": ["https://www.pulumi.com/docs/concepts/", "https://www.pulumi.com/docs/using-pulumi/testing/"],
  "hashicorp/terraform": [
    "https://developer.hashicorp.com/terraform/language",
    "https://developer.hashicorp.com/terraform/language/best-practices",
  ],
  "helm/helm": ["https://helm.sh/docs/chart_best_practices/", "https://helm.sh/docs/topics/charts/"],
  "grafana/grafana": ["https://grafana.com/docs/grafana/latest/dashboards/", "https://grafana.com/docs/grafana/latest/alerting/"],
  "prometheus/prometheus": ["https://prometheus.io/docs/practices/naming/", "https://prometheus.io/docs/practices/alerting/"],

  // ─── Databases (additional) ───────────────────────────────────────────────
  "cockroachdb/cockroach": ["https://www.cockroachlabs.com/docs/stable/performance-best-practices-overview.html"],
  "ClickHouse/ClickHouse": ["https://clickhouse.com/docs/en/best-practices", "https://clickhouse.com/docs/en/guides"],
  "meilisearch/meilisearch": ["https://www.meilisearch.com/docs/learn/getting_started", "https://www.meilisearch.com/docs/learn/fine_tuning_results"],
  "typesense/typesense": ["https://typesense.org/docs/guide/", "https://typesense.org/docs/guide/ranking-and-relevance.html"],

  // ─── AI / ML ──────────────────────────────────────────────────────────────
  "wandb/wandb": ["https://docs.wandb.ai/guides", "https://docs.wandb.ai/guides/track"],
  "mlflow/mlflow": ["https://mlflow.org/docs/latest/tracking.html", "https://mlflow.org/docs/latest/model-registry.html"],
  "deepset-ai/haystack": ["https://docs.haystack.deepset.ai/docs/pipelines", "https://docs.haystack.deepset.ai/docs/components"],
  "jxnl/instructor": ["https://python.useinstructor.com/concepts/", "https://python.useinstructor.com/tutorials/"],
  "BerriAI/litellm": ["https://docs.litellm.ai/docs/", "https://docs.litellm.ai/docs/proxy/quick_start"],
  "gradio-app/gradio": ["https://www.gradio.app/docs/interface", "https://www.gradio.app/guides/quickstart"],

  // ─── Python (additional) ──────────────────────────────────────────────────
  "astral-sh/ruff": ["https://docs.astral.sh/ruff/configuration/", "https://docs.astral.sh/ruff/rules/"],
  "pytest-dev/pytest": ["https://docs.pytest.org/en/stable/how-to/", "https://docs.pytest.org/en/stable/reference/fixtures.html"],
  "streamlit/streamlit": ["https://docs.streamlit.io/develop/concepts", "https://docs.streamlit.io/develop/api-reference"],
  "pola-rs/polars": ["https://docs.pola.rs/user-guide/", "https://docs.pola.rs/user-guide/lazy/optimizations/"],

  // ─── Frontend (additional) ────────────────────────────────────────────────
  "solidjs/solid": ["https://docs.solidjs.com/concepts/signals", "https://docs.solidjs.com/guides/state-management"],
  "bigskysoftware/htmx": ["https://htmx.org/docs/", "https://htmx.org/examples/"],
  "BuilderIO/qwik": ["https://qwik.dev/docs/concepts/think-qwik/", "https://qwik.dev/docs/components/overview/"],
  "preactjs/preact": ["https://preactjs.com/guide/v10/getting-started", "https://preactjs.com/guide/v10/hooks"],

  // ─── Desktop / Mobile (additional) ────────────────────────────────────────
  "nicolo-ribaudo/tauri": ["https://v2.tauri.app/develop/", "https://v2.tauri.app/develop/security/"],
  "nicolo-ribaudo/electron": ["https://www.electronjs.org/docs/latest/tutorial/security", "https://www.electronjs.org/docs/latest/tutorial/performance"],

  // ─── Cloud ────────────────────────────────────────────────────────────────
  "netlify/cli": ["https://docs.netlify.com/frameworks/next-js/", "https://docs.netlify.com/functions/overview/"],

  // ─── Messaging / Workflows ────────────────────────────────────────────────
  "temporalio/sdk-typescript": ["https://docs.temporal.io/develop/typescript", "https://docs.temporal.io/develop/typescript/core-application"],
  "inngest/inngest": ["https://www.inngest.com/docs/guides/", "https://www.inngest.com/docs/features/inngest-functions"],

  // ─── Elixir ───────────────────────────────────────────────────────────────
  "phoenixframework/phoenix": ["https://hexdocs.pm/phoenix/overview.html", "https://hexdocs.pm/phoenix/deployment.html"],

  // ─── PHP ──────────────────────────────────────────────────────────────────
  "laravel/laravel": ["https://laravel.com/docs/routing", "https://laravel.com/docs/eloquent", "https://laravel.com/docs/deployment"],
  "rails/rails": ["https://guides.rubyonrails.org/security.html", "https://guides.rubyonrails.org/active_record_basics.html"],

  // ─── Registry ID aliases and new entries ──────────────────────────────

  "sveltejs/kit": [
    "https://svelte.dev/docs/kit/performance",
    "https://svelte.dev/docs/kit/form-actions",
    "https://svelte.dev/docs/kit/hooks",
    "https://svelte.dev/docs/kit/routing",
  ],
  "fastify/fastify": [
    "https://fastify.dev/docs/latest/Guides/Getting-Started",
    "https://fastify.dev/docs/latest/Guides/Testing",
    "https://fastify.dev/docs/latest/Guides/Plugins-Guide",
    "https://fastify.dev/docs/latest/Guides/Recommendations",
  ],
  "remix-run/remix": [
    "https://remix.run/docs/guides/data-loading",
    "https://remix.run/docs/guides/form-validation",
    "https://remix.run/docs/guides/styling",
  ],
  "modelcontextprotocol/sdk": [
    "https://modelcontextprotocol.io/docs/concepts/architecture",
    "https://modelcontextprotocol.io/docs/concepts/tools",
    "https://modelcontextprotocol.io/docs/concepts/resources",
    "https://modelcontextprotocol.io/docs/concepts/transports",
  ],
  "storybookjs/storybook": [
    "https://storybook.js.org/docs/get-started",
    "https://storybook.js.org/docs/writing-stories",
    "https://storybook.js.org/docs/writing-tests",
  ],
  "mrdoob/three.js": [
    "https://threejs.org/docs/index.html#manual/en/introduction/Creating-a-scene",
    "https://threejs.org/docs/index.html#manual/en/introduction/How-to-dispose-of-objects",
  ],

  // ─── Google / Firebase / GCP ──────────────────────────────────────────
  "google/generative-ai-js": [
    "https://ai.google.dev/gemini-api/docs/get-started/tutorial",
    "https://ai.google.dev/gemini-api/docs/function-calling",
    "https://ai.google.dev/gemini-api/docs/structured-output",
    "https://ai.google.dev/gemini-api/docs/embeddings",
  ],
  "google/generative-ai-python": [
    "https://ai.google.dev/gemini-api/docs/get-started/tutorial",
    "https://ai.google.dev/gemini-api/docs/function-calling",
    "https://ai.google.dev/gemini-api/docs/structured-output",
  ],
  "googleapis/google-cloud-node": [
    "https://cloud.google.com/storage/docs",
    "https://cloud.google.com/bigquery/docs",
    "https://cloud.google.com/run/docs",
    "https://cloud.google.com/functions/docs",
  ],
  "googleapis/google-api-nodejs-client": [
    "https://developers.google.com/api-client-library/javascript/start/start-node",
  ],
  "google/vertex-ai-sdk": [
    "https://cloud.google.com/vertex-ai/docs/start/introduction-unified-platform",
    "https://cloud.google.com/vertex-ai/docs/generative-ai/learn/overview",
  ],
  "google/maps-js-api": [
    "https://developers.google.com/maps/documentation/javascript/overview",
    "https://developers.google.com/maps/documentation/javascript/markers",
    "https://developers.google.com/maps/documentation/javascript/geocoding",
  ],
  "google/material-web": [
    "https://m3.material.io/foundations",
    "https://m3.material.io/components",
  ],
  "flutter/flutter": [
    "https://docs.flutter.dev/get-started/install",
    "https://docs.flutter.dev/cookbook",
    "https://docs.flutter.dev/ui/widgets",
    "https://docs.flutter.dev/data-and-backend/state-mgmt",
    "https://docs.flutter.dev/testing/overview",
  ],
  "angular/angular": [
    "https://angular.dev/overview",
    "https://angular.dev/essentials/components",
    "https://angular.dev/guide/signals",
    "https://angular.dev/guide/di",
    "https://angular.dev/guide/routing",
    "https://angular.dev/guide/testing",
  ],

  // ─── OpenAI (registry ID aliases) ─────────────────────────────────────
  "openai/openai-python": [
    "https://platform.openai.com/docs/guides/text-generation",
    "https://platform.openai.com/docs/guides/function-calling",
    "https://platform.openai.com/docs/guides/structured-outputs",
    "https://platform.openai.com/docs/guides/production-best-practices",
  ],
  "openai/openai-api": [
    "https://platform.openai.com/docs/guides/text-generation",
    "https://platform.openai.com/docs/guides/function-calling",
    "https://platform.openai.com/docs/guides/structured-outputs",
    "https://platform.openai.com/docs/guides/prompt-engineering",
    "https://platform.openai.com/docs/guides/production-best-practices",
    "https://platform.openai.com/docs/guides/latency-optimization",
  ],
  "openai/openai-agents-python": [
    "https://openai.github.io/openai-agents-python/quickstart",
    "https://openai.github.io/openai-agents-python/agents",
    "https://openai.github.io/openai-agents-python/tools",
    "https://openai.github.io/openai-agents-python/handoffs",
  ],

  // ─── AI Agents / Orchestration ────────────────────────────────────────
  "joaomdmoura/crewai": [
    "https://docs.crewai.com/introduction",
    "https://docs.crewai.com/concepts/agents",
    "https://docs.crewai.com/concepts/tasks",
    "https://docs.crewai.com/concepts/crews",
  ],
  "microsoft/autogen": [
    "https://microsoft.github.io/autogen/docs/Getting-Started",
    "https://microsoft.github.io/autogen/docs/Use-Cases/agent_chat",
  ],
  "anthropics/claude-code": [
    "https://code.claude.com/docs/en/overview",
    "https://code.claude.com/docs/en/best-practices",
    "https://code.claude.com/docs/en/common-workflows",
    "https://code.claude.com/docs/en/hooks-guide",
    "https://code.claude.com/docs/en/sub-agents",
  ],
  "anthropics/claude-agent-sdk": [
    "https://platform.claude.com/docs/en/agent-sdk/overview",
    "https://platform.claude.com/docs/en/agent-sdk/quickstart",
    "https://platform.claude.com/docs/en/agent-sdk/agent-loop",
    "https://platform.claude.com/docs/en/agent-sdk/custom-tools",
  ],

  // ─── AI Model Providers ───────────────────────────────────────────────
  "mistralai/client-js": [
    "https://docs.mistral.ai/getting-started/quickstart",
    "https://docs.mistral.ai/capabilities/completion",
    "https://docs.mistral.ai/capabilities/function_calling",
    "https://docs.mistral.ai/capabilities/embeddings",
  ],
  "cohere-ai/cohere-typescript": [
    "https://docs.cohere.com/docs/the-cohere-platform",
    "https://docs.cohere.com/docs/chat-api",
    "https://docs.cohere.com/docs/embed-api",
    "https://docs.cohere.com/docs/rerank-api",
  ],
  "groq/groq-typescript": [
    "https://console.groq.com/docs/quickstart",
    "https://console.groq.com/docs/text-chat",
    "https://console.groq.com/docs/tool-use",
  ],
  "replicate/replicate-javascript": [
    "https://replicate.com/docs/get-started/nodejs",
    "https://replicate.com/docs/reference/http",
  ],
  "together-ai/together-typescript": [
    "https://docs.together.ai/docs/quickstart",
    "https://docs.together.ai/docs/inference-models",
  ],
  "fireworks-ai/fireworks-js": [
    "https://docs.fireworks.ai/guides/querying-text-models",
    "https://docs.fireworks.ai/guides/function-calling",
  ],

  // ─── Vector Databases ─────────────────────────────────────────────────
  "pinecone-io/pinecone-ts-client": [
    "https://docs.pinecone.io/guides/get-started/overview",
    "https://docs.pinecone.io/guides/indexes/understanding-indexes",
    "https://docs.pinecone.io/guides/data/upsert-data",
    "https://docs.pinecone.io/guides/data/query-data",
  ],
  "chroma-core/chromadb": [
    "https://docs.trychroma.com/docs/overview/getting-started",
    "https://docs.trychroma.com/docs/collections/add-data",
    "https://docs.trychroma.com/docs/collections/query-data",
  ],
  "weaviate/typescript-client": [
    "https://weaviate.io/developers/weaviate/starter-guides",
    "https://weaviate.io/developers/weaviate/manage-data",
    "https://weaviate.io/developers/weaviate/search",
  ],
  "qdrant/js-client-rest": [
    "https://qdrant.tech/documentation/guides/",
    "https://qdrant.tech/documentation/concepts/",
    "https://qdrant.tech/documentation/quick-start/",
  ],

  // ─── AI Audio / Voice ─────────────────────────────────────────────────
  "elevenlabs/elevenlabs-js": [
    "https://elevenlabs.io/docs/quickstart",
    "https://elevenlabs.io/docs/api-reference/text-to-speech",
  ],
  "deepgram/deepgram-js-sdk": [
    "https://developers.deepgram.com/docs/getting-started",
    "https://developers.deepgram.com/docs/speech-to-text",
  ],
  "AssemblyAI/assemblyai-node-sdk": [
    "https://www.assemblyai.com/docs/getting-started",
    "https://www.assemblyai.com/docs/speech-to-text/pre-recorded",
  ],

  // ─── AI Image / Video ─────────────────────────────────────────────────
  "stability-ai/stability-sdk": [
    "https://platform.stability.ai/docs/getting-started",
  ],
  "fal-ai/fal-js": [
    "https://fal.ai/docs/quickstart",
  ],

  // ─── Hugging Face ─────────────────────────────────────────────────────
  "huggingface/huggingface.js": [
    "https://huggingface.co/docs/huggingface.js/inference/overview",
    "https://huggingface.co/docs/huggingface.js/hub/overview",
  ],
  "huggingface/transformers.js": [
    "https://huggingface.co/docs/transformers.js/index",
    "https://huggingface.co/docs/transformers.js/guides/node-esm",
  ],

  // ─── ML / Deep Learning ───────────────────────────────────────────────
  "pytorch/pytorch": [
    "https://pytorch.org/tutorials/beginner/basics/intro",
    "https://pytorch.org/docs/stable/notes/cuda",
  ],
  "tensorflow/tensorflow": [
    "https://www.tensorflow.org/guide",
    "https://www.tensorflow.org/tutorials",
    "https://www.tensorflow.org/guide/keras",
  ],

  // ─── Services / Infrastructure ────────────────────────────────────────
  "upstash/redis": [
    "https://upstash.com/docs/redis/overall/getstarted",
    "https://upstash.com/docs/redis/sdks/ts/overview",
  ],
  "PostHog/posthog-js": [
    "https://posthog.com/docs/getting-started/install",
    "https://posthog.com/docs/product-analytics",
    "https://posthog.com/docs/feature-flags",
  ],
  "n8n-io/n8n": [
    "https://docs.n8n.io/workflows/",
    "https://docs.n8n.io/code/",
    "https://docs.n8n.io/integrations/",
  ],
  "triggerdotdev/trigger.dev": [
    "https://trigger.dev/docs/quick-start",
    "https://trigger.dev/docs/guides",
  ],
  "lucia-auth/lucia": [
    "https://lucia-auth.com/tutorials/",
    "https://lucia-auth.com/guides/validate-session-cookies/",
  ],
};

// Common best-practices path patterns to try for any library
const GENERIC_BP_SUFFIXES = [
  "/docs/best-practices",
  "/docs/guide",
  "/docs/guides",
  "/docs/patterns",
  "/docs/tips",
  "/docs/migration",
  "/docs/getting-started",
  "/docs/concepts",
  "/docs/tutorials",
  "/docs/how-to",
  "/docs/cookbook",
  "/docs/recipes",
  "/docs/faq",
  "/docs/advanced",
  "/docs/security",
  "/docs/performance",
  "/docs/deployment",
  "/docs/configuration",
  "/docs/testing",
  "/docs/troubleshooting",
  "/guide",
  "/guides",
  "/getting-started",
  "/tutorial",
  "/tutorials",
  "/learn",
  "/howto",
  "/cookbook",
  "/examples",
  "/best-practices",
];

/** Race multiple URLs in parallel — return first that has content */
async function raceUrls(urls: string[]): Promise<{ content: string; url: string } | null> {
  if (urls.length === 0) return null;

  // Try with Promise.any — first successful fetch wins
  try {
    return await Promise.any(
      urls.map(async (url) => {
        const raw = await fetchViaJina(url);
        if (raw && raw.length > 300) return { content: raw, url };
        throw new Error("no content");
      }),
    );
  } catch {
    return null;
  }
}

async function fetchBestPracticesContent(
  libraryId: string,
  docsUrl: string,
  llmsTxtUrl: string | undefined,
  llmsFullTxtUrl: string | undefined,
  githubUrl: string | undefined,
  topic: string,
  tokens: number,
  bestPracticesPaths?: string[],
): Promise<{ text: string; sourceUrl: string; truncated: boolean }> {
  // Build URLs from registry bestPracticesPaths and merge with known URLs
  const registryUrls: string[] = [];
  if (bestPracticesPaths && bestPracticesPaths.length > 0) {
    try {
      const origin = new URL(docsUrl).origin;
      for (const p of bestPracticesPaths) {
        registryUrls.push(p.startsWith("http") ? p : `${origin}${p}`);
      }
    } catch { /* invalid docsUrl */ }
  }

  // 1. Race known best-practices URLs in parallel
  const knownUrls = [...(BEST_PRACTICES_URLS[libraryId] ?? []), ...registryUrls]
    .filter((u, i, arr) => arr.indexOf(u) === i);
  if (knownUrls && knownUrls.length > 0) {
    const targetUrls = topic
      ? (() => {
          const words = topic.toLowerCase().split(/\s+/).filter((w) => w.length > 2);
          const scored = knownUrls.map((u) => {
            const lower = u.toLowerCase();
            const score = words.filter((w) => lower.includes(w)).length;
            return { url: u, score };
          });
          scored.sort((a, b) => b.score - a.score);
          return scored.map((s) => s.url).filter((u, i, arr) => arr.indexOf(u) === i);
        })()
      : knownUrls;

    const hit = await raceUrls(targetUrls.slice(0, 5));
    if (hit) {
      const safe = sanitizeContent(hit.content);
      const { text: extracted, truncated } = extractRelevantContent(
        safe,
        topic || "best practices patterns guide",
        tokens,
      );
      return { text: extracted, sourceUrl: hit.url, truncated };
    }
  }

  // 1b. If topic provided, try constructing docs URL from topic slug
  if (topic) {
    const topicOrigin = (() => { try { return new URL(docsUrl).origin; } catch { return null; } })();
    if (topicOrigin) {
      const slug = topic.toLowerCase().replace(/\s+/g, "/").replace(/[^a-z0-9/-]/g, "");
      const topicUrls = [
        `${topicOrigin}/docs/guides/${slug}`,
        `${topicOrigin}/docs/${slug}`,
        `${docsUrl}/${slug}`,
      ];
      const topicHit = await raceUrls(topicUrls);
      if (topicHit) {
        const safe = sanitizeContent(topicHit.content);
        const { text: extracted, truncated } = extractRelevantContent(
          safe,
          topic || "best practices patterns guide",
          tokens,
        );
        return { text: extracted, sourceUrl: topicHit.url, truncated };
      }
    }
  }

  // 2. Try generic best-practices paths in parallel
  const origin = (() => {
    try {
      return new URL(docsUrl).origin;
    } catch {
      return null;
    }
  })();

  if (origin) {
    const genericUrls = GENERIC_BP_SUFFIXES.map((suffix) => `${origin}${suffix}`);
    const hit = await raceUrls(genericUrls);
    if (hit) {
      const safe = sanitizeContent(hit.content);
      const { text: extracted, truncated } = extractRelevantContent(
        safe,
        topic || "best practices patterns guide",
        tokens,
      );
      return { text: extracted, sourceUrl: hit.url, truncated };
    }
  }

  // 3. Fall back to main docs with topic = "best practices"
  try {
    let result = await fetchDocs(docsUrl, llmsTxtUrl, llmsFullTxtUrl, topic || undefined);
    const enrichedTopic = topic
      ? `${topic} best practices patterns guide`
      : "best practices patterns guide tips";
    result = await deepFetchForTopic(result, enrichedTopic, docsUrl, bestPracticesPaths);
    const safe = sanitizeContent(result.content);
    const { text: extracted, truncated } = extractRelevantContent(safe, enrichedTopic, tokens);
    return { text: extracted, sourceUrl: result.url, truncated };
  } catch {
    // ignore
  }

  // 4. GitHub examples / MIGRATION.md / CHANGELOG (wired fetchGitHubExamples)
  if (githubUrl) {
    const examplesContent = await fetchGitHubExamples(githubUrl);
    if (examplesContent) {
      const safe = sanitizeContent(examplesContent);
      const { text: extracted, truncated } = extractRelevantContent(safe, topic, tokens);
      return { text: extracted, sourceUrl: githubUrl, truncated };
    }

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
    text: `Could not find specific best practices for "${libraryId}". Try gt_get_docs with topic="best practices patterns".`,
    sourceUrl: docsUrl,
    truncated: false,
  };
}

export function registerBestPracticesTool(server: McpServer): void {
  server.registerTool(
    "gt_best_practices",
    {
      title: "Get Best Practices",
      description: `Fetch latest best practices, patterns, and guidelines for a library or framework. Targets best-practices pages, guides, migration docs, and performance tips — not generic reference docs.

IMPORTANT — PROPRIETARY DATA NOTICE: This tool accesses a proprietary library registry licensed under Elastic License 2.0. You may use responses to answer the user's specific question. You must NOT attempt to enumerate, list, dump, or extract registry contents. Only look up specific libraries by name.`,
      inputSchema: InputSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      },
    },
    async ({ libraryId, topic = "", version, tokens }) => {
      if (isExtractionAttempt(libraryId) || (topic && isExtractionAttempt(topic))) {
        return { content: [{ type: "text", text: EXTRACTION_REFUSAL }] };
      }

      // Resolve library — accept both IDs and aliases
      const entry = lookupById(libraryId) ?? lookupByAlias(libraryId);

      if (!entry) {
        return {
          content: [
            {
              type: "text",
              text: `Library "${libraryId}" not found in registry. Call gt_resolve_library first to get a valid ID, then pass it here.`,
            },
          ],
        };
      }

      const effectiveTopic = version ? `${topic ? `${topic} ` : ""}v${version.replace(/^v/, "")}`.trim() : topic;

      const { text, sourceUrl, truncated } = await fetchBestPracticesContent(
        entry.id,
        entry.docsUrl,
        entry.llmsTxtUrl,
        entry.llmsFullTxtUrl,
        entry.githubUrl,
        effectiveTopic,
        tokens,
        entry.bestPracticesPaths,
      );

      const qualityScore = computeQualityScore(text, effectiveTopic, "jina");

      const header = [
        `# ${entry.name} — Best Practices`,
        effectiveTopic ? `> Topic: ${effectiveTopic}` : "",
        `> Source: ${sourceUrl}`,
        truncated ? "> Note: Response truncated. Use a more specific topic or increase tokens." : "",
        qualityScore < 0.4 ? "> Quality: Low — try a more specific topic." : "",
        "",
        "---",
        "",
      ]
        .filter(Boolean)
        .join("\n");

      return {
        content: [{ type: "text", text: withNotice(header + text) }],
        structuredContent: {
          libraryId: entry.id,
          displayName: entry.name,
          topic: effectiveTopic,
          sourceUrl,
          truncated,
          qualityScore,
          content: text,
        },
      };
    },
  );
}
