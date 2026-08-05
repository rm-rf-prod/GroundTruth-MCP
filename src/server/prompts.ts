import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

/** Discoverable workflow templates, shown as slash commands in compatible clients. */
export function registerPrompts(server: McpServer): void {
  server.prompt(
    "audit-my-project",
    "Scan this project for code issues and fetch live best-practice fixes from official docs",
    () => ({
      messages: [{
        role: "user",
        content: { type: "text", text: "Please use gt_audit to scan this project for all code issues (layout, performance, accessibility, security, React, Next.js, TypeScript, Node.js, Python). For each issue type found, fetch live best-practice fixes and show me what to change at each file:line location." },
      }],
    }),
  );

  server.prompt(
    "upgrade-check",
    "Check release notes and breaking changes before upgrading a library",
    { library: z.string().describe("Library to check, e.g. 'nextjs', 'react', 'prisma'") },
    ({ library }) => ({
      messages: [{
        role: "user",
        content: { type: "text", text: `Use gt_changelog to fetch the recent release notes for ${library}. Summarize what changed, highlight any breaking changes, and list migration steps if available.` },
      }],
    }),
  );

  server.prompt(
    "best-practices-scan",
    "Get current best practices for every library in this project",
    () => ({
      messages: [{
        role: "user",
        content: { type: "text", text: "Use gt_auto_scan to detect all dependencies in this project and fetch the latest best practices for each one. Highlight any patterns we should update." },
      }],
    }),
  );

  server.prompt(
    "compare-libraries",
    "Compare two or three libraries side-by-side to decide which one to use",
    { libraries: z.string().describe("Comma-separated library names, e.g. 'prisma, drizzle-orm' or 'zod, valibot, yup'") },
    ({ libraries }) => ({
      messages: [{
        role: "user",
        content: { type: "text", text: `Use gt_compare to compare these libraries side-by-side: ${libraries}. Show their key differences, tradeoffs, and which use cases each one fits best.` },
      }],
    }),
  );

  server.prompt(
    "security-check",
    "Search OWASP and security docs for guidance on a vulnerability or security topic",
    { topic: z.string().describe("Security topic, e.g. 'SQL injection', 'JWT best practices', 'CSP headers'") },
    ({ topic }) => ({
      messages: [{
        role: "user",
        content: { type: "text", text: `Use gt_search to find the latest OWASP guidance and security best practices for: ${topic}. Include prevention techniques, code examples if available, and any relevant CVEs or spec references.` },
      }],
    }),
  );

  server.prompt(
    "migration-guide",
    "Check migration guides and breaking changes for upgrading a library between versions",
    {
      library: z.string().describe("Library to migrate, e.g. 'nextjs', 'react', 'tailwind'"),
      fromVersion: z.string().optional().describe("Version migrating from, e.g. '14'"),
      toVersion: z.string().optional().describe("Version migrating to, e.g. '15'"),
    },
    ({ library, fromVersion, toVersion }) => ({
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: `Use gt_changelog and gt_get_docs to find the migration guide for ${library}${fromVersion ? ` from v${fromVersion}` : ""}${toVersion ? ` to v${toVersion}` : ""}. List all breaking changes, required code modifications, and step-by-step upgrade instructions.`,
        },
      }],
    }),
  );

  server.prompt(
    "find-examples",
    "Find real-world code examples of a pattern using a specific library",
    {
      library: z.string().describe("Library name, e.g. 'react', 'drizzle-orm'"),
      pattern: z.string().describe("Pattern or feature, e.g. 'server actions', 'middleware', 'RLS policies'"),
    },
    ({ library, pattern }) => ({
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: `Use gt_examples to find real-world code examples of "${pattern}" using ${library}. Show the most relevant examples with context and explain the patterns used.`,
        },
      }],
    }),
  );

  server.prompt(
    "dependency-audit",
    "Scan project dependencies for outdated patterns and fetch current best practices",
    () => ({
      messages: [{
        role: "user",
        content: {
          type: "text",
          text: "Use gt_auto_scan to detect all dependencies in this project, then for each one check if we're using any deprecated patterns. Flag outdated code and fetch the current recommended approach from official docs.",
        },
      }],
    }),
  );
}
