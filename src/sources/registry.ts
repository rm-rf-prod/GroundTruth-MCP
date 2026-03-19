import type { LibraryEntry } from "../types.js";

/**
 * Community registry — 25 example entries showing the schema.
 * The full production registry (230+ libraries) is maintained privately
 * and compiled into the published npm package.
 *
 * To add a library, open a PR with the entry below.
 * Required: id, name, docsUrl. Optional but recommended: llmsTxtUrl, aliases, bestPracticesPaths.
 */
export const LIBRARY_REGISTRY: LibraryEntry[] = [
  // ─── JavaScript / TypeScript Frameworks ──────────────────────────────────────
  {
    id: "vercel/next.js",
    name: "Next.js",
    aliases: ["nextjs", "next", "next.js"],
    description: "The React Framework for the Web",
    docsUrl: "https://nextjs.org/docs",
    llmsTxtUrl: "https://nextjs.org/llms.txt",
    githubUrl: "https://github.com/vercel/next.js",
    npmPackage: "next",
    language: ["typescript", "javascript"],
    tags: ["framework", "react", "ssr", "fullstack"],
    bestPracticesPaths: [
      "/docs/app/building-your-application/rendering",
      "/docs/app/building-your-application/caching",
    ],
  },
  {
    id: "facebook/react",
    name: "React",
    aliases: ["react", "reactjs"],
    description: "A JavaScript library for building user interfaces",
    docsUrl: "https://react.dev",
    llmsTxtUrl: "https://react.dev/llms.txt",
    githubUrl: "https://github.com/facebook/react",
    npmPackage: "react",
    language: ["typescript", "javascript"],
    tags: ["ui", "frontend", "library"],
  },
  {
    id: "vuejs/vue",
    name: "Vue.js",
    aliases: ["vue", "vuejs", "vue3"],
    description: "The Progressive JavaScript Framework",
    docsUrl: "https://vuejs.org/guide/introduction",
    llmsTxtUrl: "https://vuejs.org/llms.txt",
    githubUrl: "https://github.com/vuejs/core",
    npmPackage: "vue",
    language: ["typescript", "javascript"],
    tags: ["framework", "frontend"],
  },
  {
    id: "sveltejs/svelte",
    name: "Svelte",
    aliases: ["svelte", "sveltekit"],
    description: "Cybernetically enhanced web apps",
    docsUrl: "https://svelte.dev/docs",
    llmsTxtUrl: "https://svelte.dev/llms.txt",
    githubUrl: "https://github.com/sveltejs/svelte",
    npmPackage: "svelte",
    language: ["typescript", "javascript"],
    tags: ["framework", "frontend", "compiler"],
  },
  {
    id: "honojs/hono",
    name: "Hono",
    aliases: ["hono"],
    description: "Fast, lightweight web framework for the Edge",
    docsUrl: "https://hono.dev/docs",
    llmsTxtUrl: "https://hono.dev/llms.txt",
    githubUrl: "https://github.com/honojs/hono",
    npmPackage: "hono",
    language: ["typescript", "javascript"],
    tags: ["framework", "edge", "backend", "api"],
  },
  {
    id: "expressjs/express",
    name: "Express",
    aliases: ["express", "expressjs"],
    description: "Fast, unopinionated, minimalist web framework for Node.js",
    docsUrl: "https://expressjs.com/en/4x/api.html",
    githubUrl: "https://github.com/expressjs/express",
    npmPackage: "express",
    language: ["typescript", "javascript"],
    tags: ["framework", "backend", "nodejs"],
  },

  // ─── CSS / Styling ────────────────────────────────────────────────────────────
  {
    id: "tailwindlabs/tailwindcss",
    name: "Tailwind CSS",
    aliases: ["tailwind", "tailwindcss"],
    description: "A utility-first CSS framework",
    docsUrl: "https://tailwindcss.com/docs",
    llmsTxtUrl: "https://tailwindcss.com/llms.txt",
    githubUrl: "https://github.com/tailwindlabs/tailwindcss",
    npmPackage: "tailwindcss",
    language: ["css"],
    tags: ["styling", "css", "utility-first"],
  },
  {
    id: "shadcn/ui",
    name: "shadcn/ui",
    aliases: ["shadcn", "shadcn-ui"],
    description: "Accessible component library built on Radix UI and Tailwind CSS",
    docsUrl: "https://ui.shadcn.com/docs",
    llmsTxtUrl: "https://ui.shadcn.com/llms.txt",
    githubUrl: "https://github.com/shadcn-ui/ui",
    npmPackage: "@radix-ui/react-primitive",
    language: ["typescript"],
    tags: ["ui", "components", "accessible", "radix"],
  },

  // ─── Database / ORM ───────────────────────────────────────────────────────────
  {
    id: "drizzle-team/drizzle-orm",
    name: "Drizzle ORM",
    aliases: ["drizzle", "drizzle-orm"],
    description: "TypeScript ORM that is production ready",
    docsUrl: "https://orm.drizzle.team/docs/overview",
    llmsTxtUrl: "https://orm.drizzle.team/llms.txt",
    githubUrl: "https://github.com/drizzle-team/drizzle-orm",
    npmPackage: "drizzle-orm",
    language: ["typescript"],
    tags: ["orm", "database", "sql"],
    bestPracticesPaths: ["/docs/migrations", "/docs/rls"],
  },
  {
    id: "prisma/prisma",
    name: "Prisma",
    aliases: ["prisma"],
    description: "Next-generation Node.js and TypeScript ORM",
    docsUrl: "https://www.prisma.io/docs",
    llmsTxtUrl: "https://www.prisma.io/docs/llms.txt",
    githubUrl: "https://github.com/prisma/prisma",
    npmPackage: "prisma",
    language: ["typescript"],
    tags: ["orm", "database"],
  },
  {
    id: "supabase/supabase",
    name: "Supabase",
    aliases: ["supabase"],
    description: "The open source Firebase alternative",
    docsUrl: "https://supabase.com/docs",
    llmsTxtUrl: "https://supabase.com/llms.txt",
    githubUrl: "https://github.com/supabase/supabase",
    npmPackage: "@supabase/supabase-js",
    language: ["typescript"],
    tags: ["backend", "database", "auth", "realtime"],
    bestPracticesPaths: ["/docs/guides/auth/server-side/nextjs", "/docs/guides/database/postgres/row-level-security"],
  },

  // ─── Validation / Schema ──────────────────────────────────────────────────────
  {
    id: "colinhacks/zod",
    name: "Zod",
    aliases: ["zod"],
    description: "TypeScript-first schema validation with static type inference",
    docsUrl: "https://zod.dev",
    llmsTxtUrl: "https://zod.dev/llms.txt",
    githubUrl: "https://github.com/colinhacks/zod",
    npmPackage: "zod",
    language: ["typescript"],
    tags: ["validation", "schema", "types"],
  },

  // ─── State Management ─────────────────────────────────────────────────────────
  {
    id: "pmndrs/zustand",
    name: "Zustand",
    aliases: ["zustand"],
    description: "A small, fast and scalable state-management solution",
    docsUrl: "https://zustand.docs.pmnd.rs",
    githubUrl: "https://github.com/pmndrs/zustand",
    npmPackage: "zustand",
    language: ["typescript", "javascript"],
    tags: ["state", "react"],
  },
  {
    id: "TanStack/query",
    name: "TanStack Query",
    aliases: ["tanstack-query", "react-query", "tanstack query"],
    description: "Asynchronous state management for TS/JS, React, Solid, Vue and Svelte",
    docsUrl: "https://tanstack.com/query/latest/docs/framework/react/overview",
    githubUrl: "https://github.com/TanStack/query",
    npmPackage: "@tanstack/react-query",
    language: ["typescript"],
    tags: ["state", "async", "fetching", "react"],
  },

  // ─── Testing ──────────────────────────────────────────────────────────────────
  {
    id: "vitest-dev/vitest",
    name: "Vitest",
    aliases: ["vitest"],
    description: "Blazing Fast Vite-native Test Framework",
    docsUrl: "https://vitest.dev/api",
    llmsTxtUrl: "https://vitest.dev/llms.txt",
    githubUrl: "https://github.com/vitest-dev/vitest",
    npmPackage: "vitest",
    language: ["typescript", "javascript"],
    tags: ["testing", "unit"],
  },
  {
    id: "microsoft/playwright",
    name: "Playwright",
    aliases: ["playwright"],
    description: "Fast and reliable end-to-end testing for modern web apps",
    docsUrl: "https://playwright.dev/docs/api/class-playwright",
    llmsTxtUrl: "https://playwright.dev/llms.txt",
    githubUrl: "https://github.com/microsoft/playwright",
    npmPackage: "@playwright/test",
    language: ["typescript", "javascript"],
    tags: ["testing", "e2e", "browser"],
  },

  // ─── Build Tools ──────────────────────────────────────────────────────────────
  {
    id: "vitejs/vite",
    name: "Vite",
    aliases: ["vite"],
    description: "Next generation frontend tooling",
    docsUrl: "https://vite.dev/guide",
    llmsTxtUrl: "https://vite.dev/llms.txt",
    githubUrl: "https://github.com/vitejs/vite",
    npmPackage: "vite",
    language: ["typescript", "javascript"],
    tags: ["build", "bundler", "dev-server"],
  },

  // ─── AI / ML ──────────────────────────────────────────────────────────────────
  {
    id: "vercel/ai",
    name: "Vercel AI SDK",
    aliases: ["ai-sdk", "vercel ai", "ai sdk"],
    description: "TypeScript toolkit for building AI-powered applications",
    docsUrl: "https://sdk.vercel.ai/docs",
    llmsTxtUrl: "https://sdk.vercel.ai/llms.txt",
    githubUrl: "https://github.com/vercel/ai",
    npmPackage: "ai",
    language: ["typescript"],
    tags: ["ai", "llm", "streaming"],
  },

  // ─── Mobile / React Native ────────────────────────────────────────────────────
  {
    id: "expo/expo",
    name: "Expo",
    aliases: ["expo"],
    description: "An open-source platform for making universal native apps",
    docsUrl: "https://docs.expo.dev",
    llmsTxtUrl: "https://docs.expo.dev/llms.txt",
    githubUrl: "https://github.com/expo/expo",
    npmPackage: "expo",
    language: ["typescript", "javascript"],
    tags: ["mobile", "react-native", "cross-platform"],
  },
  {
    id: "facebook/react-native",
    name: "React Native",
    aliases: ["react-native", "rn", "reactnative"],
    description: "A framework for building native apps using React",
    docsUrl: "https://reactnative.dev/docs/getting-started",
    llmsTxtUrl: "https://reactnative.dev/llms.txt",
    githubUrl: "https://github.com/facebook/react-native",
    npmPackage: "react-native",
    language: ["typescript", "javascript"],
    tags: ["mobile", "cross-platform", "native"],
  },

  // ─── Python ───────────────────────────────────────────────────────────────────
  {
    id: "tiangolo/fastapi",
    name: "FastAPI",
    aliases: ["fastapi"],
    description: "FastAPI framework, high performance, easy to learn",
    docsUrl: "https://fastapi.tiangolo.com",
    llmsTxtUrl: "https://fastapi.tiangolo.com/llms.txt",
    githubUrl: "https://github.com/tiangolo/fastapi",
    language: ["python"],
    tags: ["framework", "backend", "api", "async"],
  },
  {
    id: "django/django",
    name: "Django",
    aliases: ["django"],
    description: "The web framework for perfectionists with deadlines",
    docsUrl: "https://docs.djangoproject.com/en/stable",
    githubUrl: "https://github.com/django/django",
    language: ["python"],
    tags: ["framework", "backend", "fullstack"],
  },

  // ─── Infrastructure ───────────────────────────────────────────────────────────
  {
    id: "astro-build/astro",
    name: "Astro",
    aliases: ["astro"],
    description: "The web framework for content-driven websites",
    docsUrl: "https://docs.astro.build",
    llmsTxtUrl: "https://docs.astro.build/llms.txt",
    githubUrl: "https://github.com/withastro/astro",
    npmPackage: "astro",
    language: ["typescript", "javascript"],
    tags: ["framework", "ssg", "content"],
  },
  {
    id: "withastro/starlight",
    name: "Starlight",
    aliases: ["starlight"],
    description: "Build documentation sites with Astro",
    docsUrl: "https://starlight.astro.build/getting-started",
    githubUrl: "https://github.com/withastro/starlight",
    npmPackage: "@astrojs/starlight",
    language: ["typescript"],
    tags: ["docs", "astro", "static"],
  },

  // ─── AI / LLM SDKs ────────────────────────────────────────────────────────────
  {
    id: "anthropics/anthropic-sdk-node",
    name: "Anthropic SDK",
    aliases: ["anthropic", "@anthropic-ai/sdk", "anthropic-sdk"],
    description: "Official TypeScript SDK for the Anthropic Claude API",
    docsUrl: "https://docs.anthropic.com",
    llmsTxtUrl: "https://docs.anthropic.com/llms.txt",
    githubUrl: "https://github.com/anthropics/anthropic-sdk-node",
    npmPackage: "@anthropic-ai/sdk",
    language: ["typescript", "javascript"],
    tags: ["ai", "llm", "sdk"],
  },
  {
    id: "openai/openai-node",
    name: "OpenAI SDK",
    aliases: ["openai", "openai-sdk"],
    description: "Official TypeScript/JavaScript SDK for the OpenAI API",
    docsUrl: "https://platform.openai.com/docs",
    githubUrl: "https://github.com/openai/openai-node",
    npmPackage: "openai",
    language: ["typescript", "javascript"],
    tags: ["ai", "llm", "sdk"],
  },
  {
    id: "modelcontextprotocol/sdk",
    name: "MCP SDK",
    aliases: ["mcp", "mcp-sdk", "@modelcontextprotocol/sdk", "model-context-protocol"],
    description: "TypeScript SDK for the Model Context Protocol",
    docsUrl: "https://modelcontextprotocol.io/docs",
    llmsTxtUrl: "https://modelcontextprotocol.io/llms.txt",
    githubUrl: "https://github.com/modelcontextprotocol/typescript-sdk",
    npmPackage: "@modelcontextprotocol/sdk",
    language: ["typescript"],
    tags: ["ai", "mcp", "sdk"],
  },

  // ─── Frameworks ────────────────────────────────────────────────────────────────
  {
    id: "remix-run/remix",
    name: "Remix",
    aliases: ["remix", "@remix-run/react"],
    description: "Full stack web framework focused on web standards and user experience",
    docsUrl: "https://remix.run/docs",
    llmsTxtUrl: "https://remix.run/llms.txt",
    githubUrl: "https://github.com/remix-run/remix",
    npmPackage: "@remix-run/react",
    language: ["typescript", "javascript"],
    tags: ["framework", "fullstack", "react"],
  },
  {
    id: "nuxt/nuxt",
    name: "Nuxt",
    aliases: ["nuxt", "nuxt3", "nuxt.js"],
    description: "The intuitive Vue framework for building universal web applications",
    docsUrl: "https://nuxt.com/docs",
    llmsTxtUrl: "https://nuxt.com/llms.txt",
    githubUrl: "https://github.com/nuxt/nuxt",
    npmPackage: "nuxt",
    language: ["typescript", "javascript"],
    tags: ["framework", "vue", "fullstack"],
  },
  {
    id: "sveltejs/kit",
    name: "SvelteKit",
    aliases: ["sveltekit", "@sveltejs/kit"],
    description: "Web application framework powered by Svelte",
    docsUrl: "https://svelte.dev/docs/kit",
    llmsTxtUrl: "https://svelte.dev/llms.txt",
    githubUrl: "https://github.com/sveltejs/kit",
    npmPackage: "@sveltejs/kit",
    language: ["typescript", "javascript"],
    tags: ["framework", "svelte", "fullstack"],
  },
  {
    id: "solidjs/solid",
    name: "SolidJS",
    aliases: ["solid", "solid-js", "solidjs"],
    description: "A declarative JavaScript library for building user interfaces",
    docsUrl: "https://docs.solidjs.com",
    llmsTxtUrl: "https://docs.solidjs.com/llms.txt",
    githubUrl: "https://github.com/solidjs/solid",
    npmPackage: "solid-js",
    language: ["typescript", "javascript"],
    tags: ["framework", "ui", "reactive"],
  },
  {
    id: "fastify/fastify",
    name: "Fastify",
    aliases: ["fastify"],
    description: "Fast and low overhead web framework for Node.js",
    docsUrl: "https://fastify.dev/docs/latest",
    llmsTxtUrl: "https://fastify.dev/llms.txt",
    githubUrl: "https://github.com/fastify/fastify",
    npmPackage: "fastify",
    language: ["typescript", "javascript"],
    tags: ["framework", "backend", "http"],
  },
  {
    id: "trpc/trpc",
    name: "tRPC",
    aliases: ["trpc", "@trpc/server", "@trpc/client"],
    description: "End-to-end typesafe APIs made easy",
    docsUrl: "https://trpc.io/docs",
    llmsTxtUrl: "https://trpc.io/llms.txt",
    githubUrl: "https://github.com/trpc/trpc",
    npmPackage: "@trpc/server",
    language: ["typescript"],
    tags: ["api", "rpc", "typesafe"],
  },

  // ─── State / Validation ────────────────────────────────────────────────────────
  {
    id: "pmndrs/jotai",
    name: "Jotai",
    aliases: ["jotai"],
    description: "Primitive and flexible state management for React",
    docsUrl: "https://jotai.org/docs/introduction",
    llmsTxtUrl: "https://jotai.org/llms.txt",
    githubUrl: "https://github.com/pmndrs/jotai",
    npmPackage: "jotai",
    language: ["typescript", "javascript"],
    tags: ["state", "react", "atoms"],
  },
  {
    id: "fabian-hiller/valibot",
    name: "Valibot",
    aliases: ["valibot"],
    description: "A modular and type safe schema library for validating structural data",
    docsUrl: "https://valibot.dev/guides/introduction",
    llmsTxtUrl: "https://valibot.dev/llms.txt",
    githubUrl: "https://github.com/fabian-hiller/valibot",
    npmPackage: "valibot",
    language: ["typescript"],
    tags: ["validation", "schema", "types"],
  },
  {
    id: "Effect-TS/effect",
    name: "Effect",
    aliases: ["effect", "effect-ts"],
    description: "The missing standard library for TypeScript",
    docsUrl: "https://effect.website/docs",
    llmsTxtUrl: "https://effect.website/llms.txt",
    githubUrl: "https://github.com/Effect-TS/effect",
    npmPackage: "effect",
    language: ["typescript"],
    tags: ["functional", "effects", "typescript"],
  },

  // ─── Auth ──────────────────────────────────────────────────────────────────────
  {
    id: "nextauthjs/next-auth",
    name: "Auth.js",
    aliases: ["auth.js", "authjs", "next-auth", "nextauth"],
    description: "Authentication for the Web — works with Next.js, SvelteKit, and more",
    docsUrl: "https://authjs.dev/getting-started",
    llmsTxtUrl: "https://authjs.dev/llms.txt",
    githubUrl: "https://github.com/nextauthjs/next-auth",
    npmPackage: "next-auth",
    language: ["typescript", "javascript"],
    tags: ["auth", "oauth", "sessions"],
  },

  // ─── Database / Backend ────────────────────────────────────────────────────────
  {
    id: "socketio/socket.io",
    name: "Socket.IO",
    aliases: ["socket.io", "socketio", "socket-io"],
    description: "Bidirectional and low-latency communication for every platform",
    docsUrl: "https://socket.io/docs/v4",
    llmsTxtUrl: "https://socket.io/llms.txt",
    githubUrl: "https://github.com/socketio/socket.io",
    npmPackage: "socket.io",
    language: ["typescript", "javascript"],
    tags: ["realtime", "websockets", "networking"],
  },
  {
    id: "mongoose/mongoose",
    name: "Mongoose",
    aliases: ["mongoose"],
    description: "MongoDB object modeling designed to work in an asynchronous environment",
    docsUrl: "https://mongoosejs.com/docs",
    githubUrl: "https://github.com/Automattic/mongoose",
    npmPackage: "mongoose",
    language: ["typescript", "javascript"],
    tags: ["database", "mongodb", "odm"],
  },

  // ─── Content / CMS ─────────────────────────────────────────────────────────────
  {
    id: "payloadcms/payload",
    name: "Payload CMS",
    aliases: ["payload", "payloadcms", "payload-cms"],
    description: "The most powerful TypeScript CMS — headless, code-first, Next.js native",
    docsUrl: "https://payloadcms.com/docs",
    llmsTxtUrl: "https://payloadcms.com/llms.txt",
    githubUrl: "https://github.com/payloadcms/payload",
    npmPackage: "payload",
    language: ["typescript"],
    tags: ["cms", "headless", "nextjs"],
  },

  // ─── Tooling / Runtime ─────────────────────────────────────────────────────────
  {
    id: "oven-sh/bun",
    name: "Bun",
    aliases: ["bun", "bun.sh"],
    description: "All-in-one JavaScript runtime and toolkit: bundler, test runner, package manager",
    docsUrl: "https://bun.sh/docs",
    llmsTxtUrl: "https://bun.sh/llms.txt",
    githubUrl: "https://github.com/oven-sh/bun",
    language: ["typescript", "javascript"],
    tags: ["runtime", "bundler", "tooling"],
  },
  {
    id: "denoland/deno",
    name: "Deno",
    aliases: ["deno"],
    description: "A modern runtime for JavaScript and TypeScript",
    docsUrl: "https://docs.deno.com",
    llmsTxtUrl: "https://docs.deno.com/llms.txt",
    githubUrl: "https://github.com/denoland/deno",
    language: ["typescript", "javascript"],
    tags: ["runtime", "deno", "secure"],
  },
  {
    id: "storybookjs/storybook",
    name: "Storybook",
    aliases: ["storybook"],
    description: "Frontend workshop for building UI components and pages in isolation",
    docsUrl: "https://storybook.js.org/docs",
    llmsTxtUrl: "https://storybook.js.org/llms.txt",
    githubUrl: "https://github.com/storybookjs/storybook",
    npmPackage: "storybook",
    language: ["typescript", "javascript"],
    tags: ["ui", "components", "testing"],
  },

  // ─── Animation / Graphics ──────────────────────────────────────────────────────
  {
    id: "motiondivision/motion",
    name: "Motion",
    aliases: ["motion", "framer-motion", "motion-one"],
    description: "A production-ready motion library for React and JavaScript",
    docsUrl: "https://motion.dev/docs",
    llmsTxtUrl: "https://motion.dev/llms.txt",
    githubUrl: "https://github.com/motiondivision/motion",
    npmPackage: "motion",
    language: ["typescript", "javascript"],
    tags: ["animation", "react", "ui"],
  },
  {
    id: "mrdoob/three.js",
    name: "Three.js",
    aliases: ["three", "three.js", "threejs"],
    description: "JavaScript 3D library — WebGL renderer for the web",
    docsUrl: "https://threejs.org/docs",
    llmsTxtUrl: "https://threejs.org/docs/llms.txt",
    githubUrl: "https://github.com/mrdoob/three.js",
    npmPackage: "three",
    language: ["typescript", "javascript"],
    tags: ["3d", "webgl", "graphics"],
  },
];

/** Look up a registry entry by its exact id (e.g. "vercel/next.js"). */
export function lookupById(id: string): LibraryEntry | undefined {
  return LIBRARY_REGISTRY.find((e) => e.id === id);
}

/** Look up a registry entry by name or any of its aliases (case-insensitive). */
export function lookupByAlias(query: string): LibraryEntry | undefined {
  const q = query.toLowerCase().trim();
  return LIBRARY_REGISTRY.find(
    (e) =>
      e.name.toLowerCase() === q ||
      e.id.toLowerCase() === q ||
      (e.aliases ?? []).some((a) => a.toLowerCase() === q) ||
      (e.npmPackage !== undefined && e.npmPackage.toLowerCase() === q),
  );
}

/** Return up to `limit` entries whose name/aliases/tags contain the query string. */
export function fuzzySearch(query: string, limit = 10): LibraryEntry[] {
  const q = query.toLowerCase().trim();
  const scored: Array<{ entry: LibraryEntry; score: number }> = [];

  for (const entry of LIBRARY_REGISTRY) {
    let score = 0;
    const name = entry.name.toLowerCase();
    const id = entry.id.toLowerCase();
    const aliases = (entry.aliases ?? []).map((a) => a.toLowerCase());
    const tags = (entry.tags ?? []).map((t) => t.toLowerCase());
    const desc = (entry.description ?? "").toLowerCase();

    if (name === q || id === q || aliases.includes(q)) score += 100;
    else if (name.startsWith(q) || aliases.some((a) => a.startsWith(q))) score += 50;
    else if (name.includes(q) || id.includes(q) || aliases.some((a) => a.includes(q))) score += 25;
    else if (tags.some((t) => t.includes(q)) || desc.includes(q)) score += 10;

    if (score > 0) scored.push({ entry, score });
  }

  return scored
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((s) => s.entry);
}
