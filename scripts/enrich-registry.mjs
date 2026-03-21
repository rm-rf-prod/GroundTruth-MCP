#!/usr/bin/env node

/**
 * Registry Enrichment Script
 * Adds bestPracticesPaths and urlPatterns to all entries that are missing them.
 * Uses smart defaults based on docsUrl domain and common doc framework patterns.
 */

import { readFileSync, writeFileSync } from "fs";

const REGISTRY_PATH = "docs/private/registry.ts";

const URL_PATTERN_MAP = {
  "nextjs.org": ["/docs/app/{slug}", "/docs/app/building-your-application/{slug}"],
  "react.dev": ["/reference/react/{slug}", "/learn/{slug}"],
  "svelte.dev": ["/docs/svelte/{slug}", "/docs/kit/{slug}"],
  "vuejs.org": ["/guide/{slug}", "/api/{slug}"],
  "nuxt.com": ["/docs/guide/{slug}", "/docs/api/{slug}"],
  "remix.run": ["/docs/{slug}", "/docs/guides/{slug}"],
  "hono.dev": ["/docs/{slug}", "/docs/guides/{slug}"],
  "expressjs.com": ["/en/{slug}"],
  "fastify.dev": ["/docs/{slug}", "/docs/guides/{slug}"],
  "tailwindcss.com": ["/docs/{slug}"],
  "tanstack.com": ["/query/latest/docs/framework/react/{slug}"],
  "docs.expo.dev": ["/docs/{slug}", "/versions/latest/sdk/{slug}"],
  "reactnative.dev": ["/docs/{slug}", "/docs/components/{slug}"],
  "playwright.dev": ["/docs/{slug}", "/docs/api/class-{slug}"],
  "vitest.dev": ["/guide/{slug}", "/api/{slug}"],
  "stripe.com": ["/docs/{slug}", "/docs/payments/{slug}"],
  "supabase.com": ["/docs/guides/{slug}", "/docs/reference/javascript/{slug}"],
  "prisma.io": ["/docs/guides/{slug}", "/docs/concepts/{slug}"],
  "orm.drizzle.team": ["/docs/{slug}", "/docs/guides/{slug}"],
  "clerk.com": ["/docs/{slug}"],
  "authjs.dev": ["/docs/{slug}"],
  "vercel.com": ["/docs/{slug}"],
  "docs.deno.com": ["/runtime/{slug}"],
  "bun.sh": ["/docs/{slug}"],
  "docs.astro.build": ["/en/guides/{slug}", "/en/reference/{slug}"],
  "nestjs.com": ["/techniques/{slug}", "/fundamentals/{slug}"],
  "elysiajs.com": ["/{slug}"],
  "trpc.io": ["/docs/server/{slug}", "/docs/client/{slug}"],
  "zod.dev": ["/{slug}"],
  "docs.sentry.io": ["/platforms/javascript/{slug}"],
  "swr.vercel.app": ["/docs/{slug}"],
  "mobx.js.org": ["/{slug}"],
  "stately.ai": ["/docs/{slug}"],
  "motion.dev": ["/docs/{slug}"],
  "payloadcms.com": ["/docs/{slug}"],
  "strapi.io": ["/dev-docs/{slug}"],
  "firebase.google.com": ["/docs/{slug}"],
  "docs.anthropic.com": ["/en/docs/{slug}"],
  "platform.openai.com": ["/docs/{slug}", "/docs/guides/{slug}"],
  "pydantic.dev": ["/latest/concepts/{slug}", "/latest/api/{slug}"],
  "fastapi.tiangolo.com": ["/tutorial/{slug}", "/advanced/{slug}"],
  "flask.palletsprojects.com": ["/en/stable/{slug}"],
  "docs.djangoproject.com": ["/en/stable/topics/{slug}/"],
  "docs.rs": ["/{slug}"],
  "rocket.rs": ["/guide/{slug}"],
  "tokio.rs": ["/tokio/{slug}"],
  "gin-gonic.com": ["/docs/{slug}"],
  "docs.gofiber.io": ["/guide/{slug}"],
  "gorm.io": ["/docs/{slug}"],
  "echo.labstack.com": ["/docs/{slug}"],
  "laravel.com": ["/docs/{slug}"],
  "guides.rubyonrails.org": ["/{slug}"],
  "learn.microsoft.com": ["/en-us/{slug}"],
  "docs.spring.io": ["/spring-boot/docs/current/reference/html/{slug}"],
  "ktor.io": ["/docs/{slug}"],
  "docs.temporal.io": ["/develop/typescript/{slug}"],
  "www.inngest.com": ["/docs/{slug}"],
  "trigger.dev": ["/docs/{slug}"],
  "posthog.com": ["/docs/{slug}"],
  "docs.litellm.ai": ["/docs/{slug}"],
  "docs.wandb.ai": ["/guides/{slug}"],
  "docs.haystack.deepset.ai": ["/docs/{slug}"],
  "www.gradio.app": ["/docs/{slug}"],
  "docs.streamlit.io": ["/develop/{slug}"],
  "docs.pola.rs": ["/user-guide/{slug}"],
  "docs.pytest.org": ["/en/stable/{slug}"],
  "docs.astral.sh": ["/ruff/{slug}"],
  "docs.solidjs.com": ["/concepts/{slug}", "/guides/{slug}"],
  "qwik.dev": ["/docs/{slug}"],
  "htmx.org": ["/docs/{slug}"],
  "alpinejs.dev": ["/{slug}"],
  "lit.dev": ["/docs/{slug}"],
  "preactjs.com": ["/guide/v10/{slug}"],
  "v2.tauri.app": ["/develop/{slug}"],
  "www.electronjs.org": ["/docs/latest/{slug}"],
  "hexdocs.pm": ["/phoenix/{slug}"],
  "helm.sh": ["/docs/{slug}"],
  "www.pulumi.com": ["/docs/{slug}"],
  "developer.hashicorp.com": ["/terraform/{slug}"],
  "grafana.com": ["/docs/grafana/latest/{slug}"],
  "prometheus.io": ["/docs/{slug}"],
  "caddyserver.com": ["/docs/{slug}"],
  "www.cockroachlabs.com": ["/docs/stable/{slug}"],
  "clickhouse.com": ["/docs/en/{slug}"],
  "www.meilisearch.com": ["/docs/{slug}"],
  "typesense.org": ["/docs/{slug}"],
  "surrealdb.com": ["/docs/{slug}"],
};

const BP_PATH_MAP = {
  "nextjs.org": ["/docs/app/building-your-application/rendering", "/docs/app/building-your-application/caching", "/docs/app/building-your-application/optimizing"],
  "react.dev": ["/learn/thinking-in-react", "/reference/rules", "/learn/managing-state"],
  "svelte.dev": ["/docs/kit/performance", "/docs/svelte/best-practices"],
  "vuejs.org": ["/guide/best-practices/performance", "/guide/best-practices/security"],
  "nuxt.com": ["/docs/guide/best-practices/performance", "/docs/guide/concepts/rendering"],
  "hono.dev": ["/docs/guides/best-practices", "/docs/guides/middleware"],
  "expressjs.com": ["/en/advanced/best-practice-performance.html", "/en/advanced/best-practice-security.html"],
  "fastify.dev": ["/docs/guides/getting-started-guide", "/docs/guides/testing"],
  "tailwindcss.com": ["/docs/utility-first", "/docs/reusing-styles", "/docs/optimizing-for-production"],
  "tanstack.com": ["/query/latest/docs/framework/react/guides/important-defaults", "/query/latest/docs/framework/react/guides/caching"],
  "docs.expo.dev": ["/develop/development-builds/introduction/", "/guides/file-based-routing/"],
  "reactnative.dev": ["/docs/performance", "/docs/testing-overview", "/architecture/overview"],
  "playwright.dev": ["/docs/best-practices", "/docs/test-assertions", "/docs/locators"],
  "vitest.dev": ["/guide/mocking", "/guide/snapshot", "/guide/coverage"],
  "stripe.com": ["/docs/payments/accept-a-payment", "/docs/webhooks", "/docs/security/guide"],
  "supabase.com": ["/docs/guides/database/postgres/row-level-security", "/docs/guides/auth/overview", "/docs/guides/performance"],
  "prisma.io": ["/docs/guides/performance-and-optimization", "/docs/guides/testing"],
  "orm.drizzle.team": ["/docs/guides", "/docs/migrations", "/docs/performance"],
  "clerk.com": ["/docs/quickstarts/nextjs", "/docs/references/nextjs/auth"],
  "nestjs.com": ["/techniques/performance", "/security/authentication", "/fundamentals/testing"],
  "firebase.google.com": ["/docs/firestore/best-practices", "/docs/auth/web/start"],
  "docs.anthropic.com": ["/en/docs/build-with-claude/overview", "/en/docs/build-with-claude/tool-use"],
  "platform.openai.com": ["/docs/guides/text-generation", "/docs/guides/function-calling"],
  "fastapi.tiangolo.com": ["/tutorial/", "/advanced/", "/deployment/"],
  "docs.djangoproject.com": ["/en/stable/topics/security/", "/en/stable/topics/performance/"],
  "flask.palletsprojects.com": ["/en/stable/patterns/", "/en/stable/deploying/"],
  "gin-gonic.com": ["/docs/introduction/", "/docs/examples/"],
  "docs.gofiber.io": ["/guide/"],
  "gorm.io": ["/docs/", "/docs/performance.html"],
  "laravel.com": ["/docs/routing", "/docs/eloquent", "/docs/deployment"],
  "guides.rubyonrails.org": ["/security.html", "/active_record_basics.html"],
  "docs.spring.io": ["/spring-boot/docs/current/reference/html/getting-started.html", "/spring-boot/docs/current/reference/html/howto.html"],
  "docs.temporal.io": ["/develop/typescript", "/develop/typescript/core-application"],
  "www.inngest.com": ["/docs/guides/", "/docs/features/inngest-functions"],
  "posthog.com": ["/docs/getting-started", "/docs/product-analytics"],
  "payloadcms.com": ["/docs/getting-started/what-is-payload", "/docs/configuration/overview"],
  "strapi.io": ["/dev-docs/intro", "/dev-docs/configurations/"],
  "docs.sentry.io": ["/platforms/javascript/", "/platforms/javascript/performance/"],
  "helm.sh": ["/docs/chart_best_practices/", "/docs/topics/charts/"],
  "grafana.com": ["/docs/grafana/latest/dashboards/", "/docs/grafana/latest/alerting/"],
  "prometheus.io": ["/docs/practices/naming/", "/docs/practices/alerting/"],
  "docs.pytest.org": ["/en/stable/how-to/", "/en/stable/reference/fixtures.html"],
  "docs.streamlit.io": ["/develop/concepts", "/develop/api-reference"],
};

const content = readFileSync(REGISTRY_PATH, "utf-8");
let modified = content;
let bpAdded = 0;
let urlPatAdded = 0;

const entryRegex = /(\s*\{\s*\n\s*id:\s*"([^"]+)"[\s\S]*?docsUrl:\s*"([^"]+)"[\s\S]*?)(\s*\},)/g;
let m;
const replacements = [];

while ((m = entryRegex.exec(content)) !== null) {
  const fullBlock = m[0];
  const entryBody = m[1];
  const id = m[2];
  const docsUrl = m[3];
  const closing = m[4];

  if (id.startsWith("mdn/") || id.startsWith("owasp/") || id.startsWith("auth/") || id.startsWith("security/") || id.startsWith("web/")) continue;

  let additions = "";

  // Add bestPracticesPaths if missing
  if (!fullBlock.includes("bestPracticesPaths")) {
    let hostname;
    try { hostname = new URL(docsUrl).hostname; } catch { continue; }

    const bpPaths = BP_PATH_MAP[hostname];
    if (bpPaths) {
      additions += `    bestPracticesPaths: ${JSON.stringify(bpPaths)},\n`;
      bpAdded++;
    }
  }

  // Add urlPatterns if missing
  if (!fullBlock.includes("urlPatterns")) {
    let hostname;
    try { hostname = new URL(docsUrl).hostname; } catch { continue; }

    const patterns = URL_PATTERN_MAP[hostname];
    if (patterns) {
      additions += `    urlPatterns: ${JSON.stringify(patterns)},\n`;
      urlPatAdded++;
    }
  }

  if (additions) {
    const newBlock = entryBody + additions + closing;
    replacements.push({ old: fullBlock, new: newBlock });
  }
}

// Apply replacements in reverse order to preserve positions
for (const r of replacements.reverse()) {
  modified = modified.replace(r.old, r.new);
}

writeFileSync(REGISTRY_PATH, modified, "utf-8");
console.log(`Added bestPracticesPaths to ${bpAdded} entries`);
console.log(`Added urlPatterns to ${urlPatAdded} entries`);
