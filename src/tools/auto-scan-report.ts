import type { LibraryEntry } from "../types.js";
import type { DependencySource } from "../utils/deps/manifest.js";
import type { LibraryResult } from "./auto-scan-fetch.js";

export interface ScanReportInput {
  projectPath: string;
  topic: string;
  sources: DependencySource[];
  totalDeps: number;
  topMatched: Array<{ dep: string; entry: LibraryEntry }>;
  /** Matched libraries past the fetch cap, listed by name only. */
  notFetched: string[];
  unmatched: string[];
  versions: Map<string, string>;
  results: LibraryResult[];
}

export interface ScanReport {
  text: string;
  structuredContent: Record<string, unknown>;
}

export function renderScanReport(input: ScanReportInput): ScanReport {
  const { projectPath, topic, sources, totalDeps, topMatched, notFetched, unmatched, versions, results } = input;

  const filesList = sources.map((s) => `- ${s.file} (${s.dependencies.length} deps)`).join("\n");
  const header = [
    `# Project Dependency Scan`,
    `> Path: ${projectPath}`,
    `> Topic: ${topic}`,
    `> Found ${totalDeps} dependencies across ${sources.length} file(s)`,
    `> Matched ${topMatched.length + notFetched.length} to registry, fetched best practices for ${topMatched.length}`,
    versions.size > 0
      ? `> Lockfile versions detected: ${[...versions.entries()].map(([k, v]) => `${k}@${v}`).join(", ")}`
      : undefined,
    "",
    `**Files scanned:**`,
    filesList,
    "",
    notFetched.length > 0
      ? `> Not fetched: ${notFetched.join(", ")} — use gt_best_practices for a deep-dive on any of these.`
      : "",
    unmatched.length > 0
      ? `> Unresolved: ${unmatched.slice(0, 10).join(", ")}${unmatched.length > 10 ? ` +${unmatched.length - 10} more` : ""} — use gt_resolve_library for these.`
      : "",
    "",
    "---",
    "",
  ]
    .filter((l) => l !== undefined)
    .join("\n");

  const sections = results
    .map((r) => `## ${r.name}\n> Source: ${r.url}\n\n${r.content}\n\n---\n`)
    .join("\n");

  return {
    text: header + sections,
    structuredContent: {
      projectPath,
      topic,
      filesScanned: sources.map((s) => s.file),
      totalDependencies: totalDeps,
      matched: topMatched.map((m) => m.entry.id),
      unmatched: unmatched.slice(0, 20),
      results: results.map((r) => ({ name: r.name, url: r.url, content: r.content })),
    },
  };
}
