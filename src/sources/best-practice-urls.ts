/**
 * Curated best-practice page URLs per registry library, plus the generic
 * best-practice path suffixes probed when a library has no curated entry.
 *
 * Data table, not logic — exempt from the 200-line source convention for the
 * same reason the library registry is.
 */
export const BEST_PRACTICES_URLS: Record<string, string[]> = {
  // ─── JavaScript / TypeScript Frameworks ─────────────────────────────────
  "vercel/next.js": [
    "https://nextjs.org/docs/app/guides/production-checklist",
    "https://nextjs.org/docs/app/guides/caching",
    "https://nextjs.org/docs/app/guides/authentication",
    "https://nextjs.org/docs/app/getting-started/caching-and-revalidating",
  ],
  "facebook/react": [
    "https://react.dev/reference/rules",
    "https://react.dev/learn/you-might-not-need-an-effect",
    "https://react.dev/learn/escape-hatches",
    "https://react.dev/learn/managing-state",
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
    "https://tailwindcss.com/docs/upgrade-guide",
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
  "ariakit/ariakit": [
    "https://ariakit.org/guide",
  ],
  "chakra-ui/chakra-ui": [
    "https://v2.chakra-ui.com/docs/styled-system/customize-theme",
    "https://v2.chakra-ui.com/docs/components",
  ],
  "chakra-ui/panda": [
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
    "https://www.prisma.io/docs/orm/more/best-practices",
    "https://www.prisma.io/docs/guides/testing",
  ],
  "supabase/supabase": [
    "https://supabase.com/docs/guides/database/postgres/row-level-security",
    "https://supabase.com/docs/guides/auth/overview",
    "https://supabase.com/docs/guides/platform/performance",
    "https://supabase.com/docs/guides/troubleshooting/rls-performance-and-best-practices-Z5Jjwv",
    "https://supabase.com/docs/guides/realtime",
    "https://supabase.com/docs/guides/realtime/presence",
    "https://supabase.com/docs/guides/realtime/broadcast",
    "https://supabase.com/docs/guides/storage",
    "https://supabase.com/docs/guides/functions",
    "https://supabase.com/docs/guides/auth/server-side/nextjs",
  ],
  "neondatabase/neon": [
    "https://neon.tech/docs/guides/branching-intro",
    "https://neon.com/docs/connect/connection-pooling",
  ],
  "tursodatabase/libsql": [
    "https://docs.turso.tech/sdk/ts/guides",
    "https://docs.turso.tech/features/embedded-replicas",
  ],
  "typeorm/typeorm": [
    "https://typeorm.io/docs/data-source/data-source-options/",
    "https://typeorm.io/migrations",
    "https://typeorm.io/docs/performance-optimization/introduction/",
  ],
  "Automattic/mongoose": [
    "https://mongoosejs.com/docs/guide.html",
    "https://mongoosejs.com/docs/faq.html",
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
    "https://electric.ax/docs/sync",
  ],
  "redis/node-redis": [
    "https://redis.io/docs/latest/develop/connect/clients/nodejs/",
    "https://redis.io/docs/latest/develop/use/patterns/",
  ],

  // ─── Validation / Schema ─────────────────────────────────────────────────
  "colinhacks/zod": [
    "https://zod.dev/basics",
    "https://zod.dev/error-formatting",
  ],
  "fabian-hiller/valibot": [
    "https://valibot.dev/guides/introduction/",
    "https://valibot.dev/guides/migrate-from-zod/",
  ],
  "jquense/yup": [
    "https://github.com/jquense/yup#schema-basics",
  ],
  "effect-ts/effect": [
    "https://effect.website/docs/getting-started/introduction",
    "https://effect.website/docs/error-management/expected-errors",
    "https://effect.website/docs/concurrency/basic-concurrency",
    "https://effect.website/docs/configuration",
  ],

  // ─── State Management ────────────────────────────────────────────────────
  "pmndrs/zustand": [
    "https://zustand.docs.pmnd.rs/learn/guides/updating-state",
    "https://zustand.docs.pmnd.rs/learn/guides/beginner-typescript",
    "https://zustand.docs.pmnd.rs/learn/guides/testing",
  ],
  "pmndrs/jotai": [
    "https://jotai.org/docs/guides/typescript",
    "https://jotai.org/docs/guides/testing",
    "https://jotai.org/docs/guides/performance",
  ],
  "tanstack/query": [
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
    "https://mobx.js.org/react-integration.html",
    "https://mobx.js.org/react-optimizations.html",
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
  "testing-library/react-testing-library": [
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
    "https://biomejs.dev/linter/",
  ],
  "vercel/turborepo": [
    "https://turbo.build/repo/docs/core-concepts/caching",
    "https://turbo.build/repo/docs/core-concepts/monorepos",
    "https://turbo.build/repo/docs/reference/configuration",
  ],
  "nx/nx": [
    "https://nx.dev/concepts/mental-model",
    "https://nx.dev/docs/concepts/decisions/why-monorepos",
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
  "nodejs/node": [
    "https://nodejs.org/en/learn",
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
  "anthropics/anthropic-sdk": [
    "https://docs.anthropic.com/en/docs/build-with-claude/overview",
    "https://docs.anthropic.com/en/docs/build-with-claude/tool-use",
    "https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/overview",
    "https://docs.anthropic.com/en/docs/build-with-claude/streaming",
    "https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching",
    "https://docs.anthropic.com/en/docs/build-with-claude/vision",
    "https://docs.anthropic.com/en/docs/build-with-claude/extended-thinking",
  ],
  "openai/openai-node": [
    "https://platform.openai.com/docs/guides/text-generation",
    "https://platform.openai.com/docs/guides/function-calling",
    "https://platform.openai.com/docs/guides/structured-outputs",
    "https://platform.openai.com/docs/guides/prompt-engineering",
    "https://platform.openai.com/docs/guides/production-best-practices",
    "https://platform.openai.com/docs/guides/latency-optimization",
  ],
  "langchain-ai/langchainjs": [
    "https://js.langchain.com/docs/concepts/",
    "https://js.langchain.com/docs/how_to/",
  ],
  "run-llama/llamaindex-ts": [
    "https://ts.llamaindex.ai/docs/llamaindex/getting_started/installation",
  ],
  "huggingface/transformers.js": [
    "https://huggingface.co/docs/transformers.js/index",
    "https://huggingface.co/docs/transformers.js/tutorials/node",
    "https://huggingface.co/docs/huggingface.js/en/inference/README",
    "https://huggingface.co/docs/huggingface.js/en/hub/README",
  ],
  "ollama/ollama-js": [
    "https://github.com/ollama/ollama-js#usage",
  ],
  "assistant-ui/assistant-ui": [
    "https://www.assistant-ui.com/docs/installation",
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
    "https://docs.crewai.com/concepts/crews",
  ],
  "langchain-ai/langgraph": [
    "https://docs.langchain.com/oss/python/langgraph/overview",
  ],
  "huggingface/transformers": [
    "https://huggingface.co/docs/transformers/main/en/quicktour",
    "https://huggingface.co/docs/transformers/main/en/performance",
    "https://huggingface.co/docs/transformers/main/en/training",
  ],

  // ─── Vector Databases ────────────────────────────────────────────────────
  "pinecone-io/pinecone-ts-client": [
    "https://docs.pinecone.io/guides/get-started/overview",
    "https://docs.pinecone.io/guides/indexes/understanding-indexes",
    "https://docs.pinecone.io/guides/data/upsert-data",
    "https://docs.pinecone.io/guides/data/query-data",
  ],
  "qdrant/qdrant-js": [
    "https://qdrant.tech/documentation/guides/",
    "https://qdrant.tech/documentation/concepts/",
    "https://qdrant.tech/documentation/quick-start/",
  ],

  // ─── Auth ────────────────────────────────────────────────────────────────
  "clerk/javascript": [
    "https://clerk.com/docs/quickstarts/nextjs",
    "https://clerk.com/docs/references/nextjs/auth",
    "https://clerk.com/docs/organizations/overview",
  ],
  "nextauthjs/next-auth": [
    "https://authjs.dev/getting-started",
    "https://authjs.dev/getting-started/providers",
    "https://authjs.dev/concepts/session-strategies",
    "https://authjs.dev/getting-started/deployment",
  ],
  "better-auth/better-auth": [
    "https://www.better-auth.com/docs/installation",
    "https://www.better-auth.com/docs/authentication/email-password",
  ],
  "lucia-auth/lucia": [
    "https://lucia-auth.com/sessions/overview",
    "https://v3.lucia-auth.com/guides/validate-session-cookies/",
  ],
  "jaredhanson/passport": [
    "https://www.passportjs.org/tutorials/password/",
    "https://www.passportjs.org/concepts/authentication/",
  ],

  // ─── Mobile / React Native ───────────────────────────────────────────────
  "expo/expo": [
    "https://docs.expo.dev/develop/development-builds/introduction/",
    "https://docs.expo.dev/router/basics/core-concepts/",
    "https://docs.expo.dev/guides/using-eslint/",
    "https://docs.expo.dev/eas/",
  ],
  "facebook/react-native": [
    "https://reactnative.dev/docs/performance",
    "https://reactnative.dev/docs/style",
    "https://reactnative.dev/docs/testing-overview",
    "https://reactnative.dev/architecture/overview",
  ],
  "expo/expo-router": [
    "https://docs.expo.dev/router/introduction/",
    "https://docs.expo.dev/router/basics/navigation-layouts/",
    "https://docs.expo.dev/router/basics/navigation/",
  ],
  "react-navigation/react-navigation": [
    "https://reactnavigation.org/docs/getting-started",
    "https://reactnavigation.org/docs/auth-flow",
    "https://docs.swmansion.com/react-native-screens/",
  ],
  "shopify/flash-list": [
    "https://shopify.github.io/flash-list/docs/",
    "https://shopify.github.io/flash-list/docs/fundamentals/performance/",
  ],
  "software-mansion/react-native-reanimated": [
    "https://docs.swmansion.com/react-native-reanimated/docs/fundamentals/getting-started/",
  ],
  "mrousavy/react-native-mmkv": [
    "https://github.com/mrousavy/react-native-mmkv#usage",
  ],
  "shopify/react-native-skia": [
    "https://shopify.github.io/react-native-skia/docs/getting-started/installation",
  ],
  "nativewind/nativewind": [
    "https://www.nativewind.dev/docs/getting-started/installation",
    "https://www.nativewind.dev/docs",
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
    "https://gin-gonic.com/en/docs/quickstart/",
    "https://github.com/gin-gonic/examples",
  ],
  "gofiber/fiber": [
    "https://docs.gofiber.io/",
    "https://docs.gofiber.io/next/category/-guide/",
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
    "https://docs.strapi.io/cms/configurations",
    "https://docs.strapi.io/dev-docs/plugins-development",
  ],
  "contentful/contentful.js": [
    "https://www.contentful.com/developers/docs/sdks/javascript/tutorials/using-js-cda-sdk/",
  ],
  "withastro/astro": [
    "https://docs.astro.build/en/guides/images/",
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
    "https://content.nuxt.com/docs/getting-started/installation",
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
    "https://react.email/docs/integrations/resend",
    "https://resend.com/docs/dashboard/emails/idempotency-keys",
  ],
  "nodemailer/nodemailer": [
    "https://nodemailer.com/about/",
    "https://nodemailer.com/smtp",
    "https://nodemailer.com/transports",
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
  "codemirror/dev": [
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
  "getsentry/sentry": [
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
  "urql-graphql/urql": [
    "https://formidable.com/open-source/urql/docs/",
    "https://formidable.com/open-source/urql/docs/basics/core/",
  ],

  // ─── Cloud ───────────────────────────────────────────────────────────────
  "vercel/vercel": [
    "https://vercel.com/docs/deployment-protection",
    "https://vercel.com/docs/security",
    "https://vercel.com/docs/functions/configuring-functions/",
  ],
  "cloudflare/workers": [
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
  "lukeed/clsx": [
    "https://github.com/lukeed/clsx#readme",
  ],
  "dcastil/tailwind-merge": [
    "https://github.com/dcastil/tailwind-merge#readme",
    "https://github.com/dcastil/tailwind-merge/blob/main/docs/configuration.md",
  ],
  "ai/nanoid": [
    "https://github.com/ai/nanoid#readme",
  ],
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
  "darkroomstudio/lenis": [
    "https://lenis.darkroom.engineering",
  ],

  // ─── Sonner / Toast ──────────────────────────────────────────────────────
  "emilkowalski/sonner": [
    "https://sonner.emilkowal.ski",
  ],

  // ─── Rust Ecosystem ───────────────────────────────────────────────────────
  "serde-rs/serde": [
    "https://serde.rs/",
    "https://serde.rs/derive.html",
  ],
  "seanmonstar/reqwest": [
    "https://docs.rs/reqwest/latest/reqwest/",
  ],
  "rwf2/Rocket": [
    "https://rocket.rs/guide/",
    "https://rocket.rs/guide/configuration/",
  ],

  // ─── Go Ecosystem ────────────────────────────────────────────────────────
  "labstack/echo": [
    "https://echo.labstack.com/docs/category/middleware",
    "https://echo.labstack.com/docs/category/cookbook",
  ],
  "spf13/cobra": [
    "https://cobra.dev/",
    "https://github.com/spf13/cobra/blob/main/site/content/user_guide.md",
  ],

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
  "ktorio/ktor": [
    "https://ktor.io/docs/server-create-a-new-project.html",
    "https://ktor.io/docs/server-auto-reload.html",
  ],

  // ─── DevOps / Infrastructure ──────────────────────────────────────────────
  "ansible/ansible": [
    "https://docs.ansible.com/ansible/latest/playbook_guide/index.html",
    "https://docs.ansible.com/ansible/latest/tips_tricks/index.html",
  ],
  "pulumi/pulumi": [
    "https://www.pulumi.com/docs/concepts/",
    "https://www.pulumi.com/docs/using-pulumi/testing/",
  ],
  "hashicorp/terraform": [
    "https://developer.hashicorp.com/terraform/language",
    "https://developer.hashicorp.com/terraform/language/style",
  ],
  "helm/helm": [
    "https://helm.sh/docs/chart_best_practices/",
    "https://helm.sh/docs/topics/charts/",
  ],
  "grafana/grafana": [
    "https://grafana.com/docs/grafana/latest/dashboards/",
    "https://grafana.com/docs/grafana/latest/alerting/",
  ],
  "prometheus/prometheus": [
    "https://prometheus.io/docs/practices/naming/",
    "https://prometheus.io/docs/practices/alerting/",
  ],

  // ─── Databases (additional) ───────────────────────────────────────────────
  "cockroachdb/cockroach": [
    "https://www.cockroachlabs.com/docs/stable/performance-best-practices-overview.html",
  ],
  "ClickHouse/ClickHouse": [
    "https://clickhouse.com/docs/en/best-practices",
    "https://clickhouse.com/docs/en/guides",
  ],
  "meilisearch/meilisearch": [
    "https://www.meilisearch.com/docs/learn/getting_started",
    "https://www.meilisearch.com/docs/learn/relevancy/relevancy",
  ],
  "typesense/typesense": [
    "https://typesense.org/docs/guide/",
    "https://typesense.org/docs/guide/ranking-and-relevance.html",
  ],

  // ─── AI / ML ──────────────────────────────────────────────────────────────
  "wandb/wandb": [
    "https://docs.wandb.ai/guides",
    "https://docs.wandb.ai/guides/track",
  ],
  "mlflow/mlflow": [
    "https://mlflow.org/docs/latest/tracking.html",
    "https://mlflow.org/docs/latest/model-registry.html",
  ],
  "deepset-ai/haystack": [
    "https://docs.haystack.deepset.ai/docs/pipelines",
    "https://docs.haystack.deepset.ai/docs/components",
  ],
  "jxnl/instructor": [
    "https://python.useinstructor.com/concepts/",
    "https://python.useinstructor.com/tutorials/",
  ],
  "BerriAI/litellm": [
    "https://docs.litellm.ai/docs/",
    "https://docs.litellm.ai/docs/proxy/quick_start",
  ],
  "gradio-app/gradio": [
    "https://www.gradio.app/docs/interface",
    "https://www.gradio.app/guides/quickstart",
  ],

  // ─── Python (additional) ──────────────────────────────────────────────────
  "astral-sh/ruff": [
    "https://docs.astral.sh/ruff/configuration/",
    "https://docs.astral.sh/ruff/rules/",
  ],
  "pytest-dev/pytest": [
    "https://docs.pytest.org/en/stable/how-to/",
    "https://docs.pytest.org/en/stable/reference/fixtures.html",
  ],
  "streamlit/streamlit": [
    "https://docs.streamlit.io/develop/concepts",
    "https://docs.streamlit.io/develop/api-reference",
  ],
  "pola-rs/polars": [
    "https://docs.pola.rs/user-guide/",
    "https://docs.pola.rs/user-guide/lazy/optimizations/",
  ],

  // ─── Frontend (additional) ────────────────────────────────────────────────
  "solidjs/solid": [
    "https://docs.solidjs.com/concepts/signals",
    "https://docs.solidjs.com/guides/state-management",
  ],
  "bigskysoftware/htmx": [
    "https://htmx.org/docs/",
    "https://htmx.org/examples/",
  ],
  "BuilderIO/qwik": [
    "https://qwik.dev/docs/concepts/think-qwik/",
    "https://qwik.dev/docs/components/overview/",
  ],
  "preactjs/preact": [
    "https://preactjs.com/guide/v10/getting-started",
    "https://preactjs.com/guide/v10/hooks",
  ],

  // ─── Desktop / Mobile (additional) ────────────────────────────────────────
  "tauri-apps/tauri": [
    "https://v2.tauri.app/develop/",
    "https://v2.tauri.app/security/",
  ],
  "electron/electron": [
    "https://www.electronjs.org/docs/latest/tutorial/security",
    "https://www.electronjs.org/docs/latest/tutorial/performance",
  ],

  // ─── Cloud ────────────────────────────────────────────────────────────────
  "netlify/cli": [
    "https://docs.netlify.com/build/frameworks/framework-setup-guides/nextjs/overview/",
    "https://docs.netlify.com/functions/overview/",
  ],

  // ─── Messaging / Workflows ────────────────────────────────────────────────
  "temporalio/sdk-typescript": [
    "https://docs.temporal.io/develop/typescript",
    "https://docs.temporal.io/develop/typescript/core-application",
  ],
  "inngest/inngest": [
    "https://www.inngest.com/docs/guides/",
    "https://www.inngest.com/docs/features/inngest-functions",
  ],

  // ─── Elixir ───────────────────────────────────────────────────────────────
  "phoenixframework/phoenix": [
    "https://hexdocs.pm/phoenix/overview.html",
    "https://hexdocs.pm/phoenix/deployment.html",
  ],

  // ─── PHP ──────────────────────────────────────────────────────────────────
  "laravel/laravel": [
    "https://laravel.com/docs/routing",
    "https://laravel.com/docs/eloquent",
    "https://laravel.com/docs/deployment",
  ],
  "rails/rails": [
    "https://guides.rubyonrails.org/security.html",
    "https://guides.rubyonrails.org/active_record_basics.html",
  ],

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
  "anthropics/mcp-protocol": [
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
  "google/gemini-api": [
    "https://ai.google.dev/gemini-api/docs/get-started/tutorial",
    "https://ai.google.dev/gemini-api/docs/function-calling",
    "https://ai.google.dev/gemini-api/docs/structured-output",
    "https://ai.google.dev/gemini-api/docs/embeddings",
    "https://cloud.google.com/vertex-ai/docs/start/introduction-unified-platform",
    "https://cloud.google.com/vertex-ai/docs/generative-ai/learn/overview",
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
  "google/maps-js-api": [
    "https://developers.google.com/maps/documentation/javascript/overview",
    "https://developers.google.com/maps/documentation/javascript/markers",
    "https://developers.google.com/maps/documentation/javascript/geocoding",
  ],
  "material-components/material-web": [
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
  "openai/openai-agents-python": [
    "https://openai.github.io/openai-agents-python/quickstart",
    "https://openai.github.io/openai-agents-python/agents",
    "https://openai.github.io/openai-agents-python/tools",
    "https://openai.github.io/openai-agents-python/handoffs",
  ],

  // ─── AI Agents / Orchestration ────────────────────────────────────────
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
    "https://docs.cohere.com/reference/rerank",
  ],
  "groq/groq": [
    "https://console.groq.com/docs/quickstart",
    "https://console.groq.com/docs/text-chat",
    "https://console.groq.com/docs/tool-use",
  ],
  "replicate/replicate": [
    "https://replicate.com/docs/get-started/nodejs",
    "https://replicate.com/docs/reference/http",
  ],
  "togetherai/together": [
    "https://docs.together.ai/docs/quickstart",
    "https://docs.together.ai/docs/inference-models",
  ],
  "fireworks-ai/fireworks-js": [
    "https://docs.fireworks.ai/guides/querying-text-models",
    "https://docs.fireworks.ai/guides/function-calling",
  ],

  // ─── Vector Databases ─────────────────────────────────────────────────
  "chroma-core/chroma": [
    "https://docs.trychroma.com/docs/overview/getting-started",
    "https://docs.trychroma.com/docs/collections/add-data",
    "https://docs.trychroma.com/docs/querying-collections/query-and-get",
  ],
  "weaviate/weaviate": [
    "https://weaviate.io/developers/weaviate/starter-guides",
    "https://weaviate.io/developers/weaviate/manage-data",
    "https://weaviate.io/developers/weaviate/search",
  ],

  // ─── AI Audio / Voice ─────────────────────────────────────────────────
  "elevenlabs/elevenlabs-js": [
    "https://elevenlabs.io/docs/quickstart",
    "https://elevenlabs.io/docs/api-reference/text-to-speech",
  ],
  "deepgram/deepgram-js-sdk": [
    "https://developers.deepgram.com/docs/stt/getting-started",
    "https://developers.deepgram.com/docs/stt-pre-recorded-feature-overview",
  ],
  "AssemblyAI/assemblyai-node-sdk": [
    "https://www.assemblyai.com/docs/getting-started",
    "https://www.assemblyai.com/docs/speech-to-text",
  ],

  // ─── AI Image / Video ─────────────────────────────────────────────────
  "Stability-AI/stability-sdk": [
    "https://platform.stability.ai/docs/getting-started",
  ],
  "fal-ai/fal": [
    "https://docs.fal.ai/model-apis/quickstart",
  ],

  // ─── Hugging Face ─────────────────────────────────────────────────────

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
  "PostHog/posthog": [
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
};

// Common best-practices path patterns to try for any library
export const GENERIC_BP_SUFFIXES = [
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

/** Fetch multiple URLs in parallel — return the one with the best quality content.
 *  Uses fetchAsMarkdownRace (direct HTML extraction + Jina) for each URL,
 *  so we're not solely dependent on Jina Reader.
 */
