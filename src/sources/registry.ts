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
