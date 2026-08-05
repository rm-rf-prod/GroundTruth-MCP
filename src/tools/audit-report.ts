import type { Issue } from "../sources/audit-patterns.js";

const BADGE: Record<string, string> = {
  critical: "[CRITICAL]",
  high: "[HIGH]",
  medium: "[MEDIUM]",
  low: "[LOW]",
};

export interface AuditReport {
  text: string;
  structuredContent: {
    projectPath: string;
    filesScanned: number;
    totalIssues: number;
    uniqueIssueTypes: number;
    issues: Array<{
      title: string;
      severity?: string | undefined;
      category?: string | undefined;
      count: number;
      locations: string[];
    }>;
  };
}

function renderSection(title: string, issues: Issue[], bpMap: Map<string, string>): string {
  const first = issues[0]!;
  const locations = issues
    .slice(0, 10)
    .map((i) => `  - \`${i.file}:${i.line}\``)
    .join("\n");
  const overflow = issues.length > 10 ? `  - ...and ${issues.length - 10} more` : "";
  const bp = bpMap.get(title) ?? "";
  const bpAttempted = bpMap.has(title);
  const bpLine = bp.length > 0
    ? `**Live best practice (official docs):**\n\n${bp}`
    : bpAttempted
      ? `**Live best practice:** no on-topic official guidance verified for this finding (generic/off-topic pages were rejected by the evidence gate). The Fix above is the canonical remediation.`
      : "";

  return [
    `## ${BADGE[first.severity] ?? "[?]"} ${title}`,
    `**Category:** ${first.category} | **Severity:** ${first.severity} | **Count:** ${issues.length}`,
    "",
    `**Problem:** ${first.detail}`,
    "",
    `**Fix:** ${first.fix}`,
    "",
    "**Files:**",
    locations,
    overflow,
    "",
    bpLine,
    "",
    "---",
    "",
  ]
    .filter((l) => l !== "")
    .join("\n");
}

export function renderAuditReport(params: {
  projectPath: string;
  filesScanned: number;
  issues: Issue[];
  grouped: Map<string, Issue[]>;
  bpMap: Map<string, string>;
  categories: string[];
}): AuditReport {
  const { projectPath, filesScanned, issues, grouped, bpMap, categories } = params;

  const header = [
    `# Code Audit Report`,
    `> Path: ${projectPath}`,
    `> Files scanned: ${filesScanned} | Issues: ${issues.length} | Unique types: ${grouped.size}`,
    `> Categories: ${categories.join(", ")}`,
    "",
    "---",
    "",
  ].join("\n");

  const structuredContent = {
    projectPath,
    filesScanned,
    totalIssues: issues.length,
    uniqueIssueTypes: grouped.size,
    issues: Array.from(grouped.entries()).map(([title, occs]) => ({
      title,
      severity: occs[0]?.severity,
      category: occs[0]?.category,
      count: occs.length,
      locations: occs.slice(0, 5).map((i) => `${i.file}:${i.line}`),
    })),
  };

  if (issues.length === 0) {
    return {
      text: header + `No issues found for: ${categories.join(", ")}.\n`,
      structuredContent: { ...structuredContent, totalIssues: 0, uniqueIssueTypes: 0, issues: [] },
    };
  }

  const sections = Array.from(grouped.entries())
    .map(([title, group]) => renderSection(title, group, bpMap))
    .join("");

  return { text: header + sections, structuredContent };
}
