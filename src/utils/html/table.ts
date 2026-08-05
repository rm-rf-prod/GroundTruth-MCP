import { stripTags } from "./links.js";

export function convertTable(tableHtml: string): string {
  const rows: string[][] = [];

  // Extract rows
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let rowMatch;
  while ((rowMatch = rowRegex.exec(tableHtml)) !== null) {
    const cellRegex = /<t[hd][^>]*>([\s\S]*?)<\/t[hd]>/gi;
    const cells: string[] = [];
    let cellMatch;
    while ((cellMatch = cellRegex.exec(rowMatch[1] ?? "")) !== null) {
      cells.push(stripTags(cellMatch[1] ?? "").trim());
    }
    if (cells.length > 0) rows.push(cells);
  }

  if (rows.length === 0) return "";

  // Build markdown table
  const colCount = Math.max(...rows.map((r) => r.length));
  const lines: string[] = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const padded = Array.from({ length: colCount }, (_, j) => row[j] ?? "");
    lines.push(`| ${padded.join(" | ")} |`);

    // Add separator after first row (header)
    if (i === 0) {
      lines.push(`| ${padded.map(() => "---").join(" | ")} |`);
    }
  }

  return "\n" + lines.join("\n") + "\n";
}
