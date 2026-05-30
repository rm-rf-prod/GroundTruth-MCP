import type { Snippet } from "../types.js";
import { createHash } from "crypto";
import { tokenize } from "./extract.js";

const MIN_CODE_LENGTH = 20;
const MAX_CODE_LENGTH = 4000;
const MAX_DESCRIPTION_LENGTH = 280;
const MAX_TITLE_LENGTH = 120;

const FENCE_RE = /^(```|~~~)([a-zA-Z0-9_+\-.#]*)\s*$/;
const HEADING_RE = /^(#{1,6})\s+(.+?)\s*$/;
const HTML_TAG_RE = /<[^>]+>/g;

const LANGUAGE_ALIASES: Record<string, string> = {
  js: "javascript", jsx: "javascript", ts: "typescript", tsx: "typescript",
  py: "python", rb: "ruby", rs: "rust", kt: "kotlin", cs: "csharp",
  sh: "bash", shell: "bash", zsh: "bash", yml: "yaml",
  md: "markdown", txt: "text", "": "text",
  "c++": "cpp", "c#": "csharp", "f#": "fsharp",
  html: "html", htm: "html", xml: "xml", json: "json", json5: "json",
  graphql: "graphql", gql: "graphql", sql: "sql", psql: "sql",
  toml: "toml", ini: "ini", dockerfile: "dockerfile", docker: "dockerfile",
  vue: "vue", svelte: "svelte", astro: "astro",
  proto: "protobuf", protobuf: "protobuf",
  hcl: "hcl", terraform: "hcl", tf: "hcl",
};

function normalizeLanguage(raw: string): string {
  const lower = raw.toLowerCase().trim();
  return LANGUAGE_ALIASES[lower] ?? lower ?? "text";
}

function stripFormatting(text: string): string {
  return text
    .replace(HTML_TAG_RE, "")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_`]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function snippetId(library: string, version: string | undefined, title: string, codeHead: string): string {
  const key = `${library}|${version ?? "latest"}|${title}|${codeHead.slice(0, 80)}`;
  return createHash("sha256").update(key).digest("hex").slice(0, 16);
}

function describeFromProse(prose: string[]): string {
  const joined = prose.join("\n").trim();
  if (!joined) return "";
  const clean = stripFormatting(joined);
  if (clean.length <= MAX_DESCRIPTION_LENGTH) return clean;
  const cut = clean.slice(0, MAX_DESCRIPTION_LENGTH);
  const lastStop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  return lastStop > MAX_DESCRIPTION_LENGTH * 0.5 ? cut.slice(0, lastStop + 1) : cut + "…";
}

function fallbackTitle(language: string, code: string, library: string): string {
  const firstLine = code.split("\n").find((l) => l.trim())?.trim() ?? "";
  if (firstLine && firstLine.length <= MAX_TITLE_LENGTH) {
    return `${library}: ${stripFormatting(firstLine).slice(0, MAX_TITLE_LENGTH)}`;
  }
  return `${library} ${language} example`;
}

/**
 * Parse markdown content into structured code snippets with surrounding context.
 * Each fenced code block becomes a Snippet with its nearest heading as title and
 * preceding prose as description.
 */
export function extractSnippets(
  content: string,
  library: string,
  sourceUrl: string,
  version?: string,
): Snippet[] {
  if (!content || content.length < 50) return [];

  const lines = content.split("\n");
  const snippets: Snippet[] = [];
  const headingStack: Array<{ level: number; text: string }> = [];
  let proseBuffer: string[] = [];
  let codeBuffer: string[] = [];
  let inCode = false;
  let currentFence = "";
  let currentLanguage = "";

  function flushProse(): void {
    if (proseBuffer.length > 8) proseBuffer = proseBuffer.slice(-8);
  }

  function currentHeading(): string {
    if (headingStack.length === 0) return "";
    const recent = headingStack[headingStack.length - 1];
    return recent ? recent.text : "";
  }

  for (const rawLine of lines) {
    const line = rawLine.replace(/\r$/, "");

    if (inCode) {
      if (line.trimEnd().startsWith(currentFence)) {
        const code = codeBuffer.join("\n").trim();
        if (code.length >= MIN_CODE_LENGTH && code.length <= MAX_CODE_LENGTH) {
          const heading = currentHeading();
          const title = heading
            ? stripFormatting(heading).slice(0, MAX_TITLE_LENGTH)
            : fallbackTitle(currentLanguage, code, library);
          const description = describeFromProse(proseBuffer);
          const snippet: Snippet = {
            id: snippetId(library, version, title, code),
            library,
            title,
            description,
            code,
            language: normalizeLanguage(currentLanguage),
            source: sourceUrl,
            score: 0,
          };
          if (version !== undefined) snippet.version = version;
          snippets.push(snippet);
        }
        codeBuffer = [];
        inCode = false;
        currentFence = "";
        currentLanguage = "";
        proseBuffer = [];
        continue;
      }
      codeBuffer.push(line);
      continue;
    }

    const fenceMatch = FENCE_RE.exec(line.trimEnd());
    if (fenceMatch) {
      inCode = true;
      currentFence = fenceMatch[1] ?? "```";
      currentLanguage = fenceMatch[2] ?? "";
      continue;
    }

    const headingMatch = HEADING_RE.exec(line);
    if (headingMatch) {
      const level = headingMatch[1]?.length ?? 1;
      const text = headingMatch[2] ?? "";
      while (headingStack.length > 0 && (headingStack[headingStack.length - 1]?.level ?? 0) >= level) {
        headingStack.pop();
      }
      headingStack.push({ level, text });
      proseBuffer = [];
      continue;
    }

    if (line.trim().length > 0) {
      proseBuffer.push(line);
      flushProse();
    } else if (proseBuffer.length > 0 && proseBuffer[proseBuffer.length - 1] !== "") {
      proseBuffer.push("");
    }
  }

  return dedupeSnippets(snippets);
}

function dedupeSnippets(snippets: Snippet[]): Snippet[] {
  const seen = new Set<string>();
  const out: Snippet[] = [];
  for (const s of snippets) {
    const key = `${s.title}|${s.code.slice(0, 200)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

function buildSnippetIDF(snippets: Snippet[], queryTokens: string[]): Map<string, number> {
  const N = Math.max(snippets.length, 1);
  const idf = new Map<string, number>();
  for (const qt of queryTokens) {
    let df = 0;
    for (const s of snippets) {
      const tokens = tokenize(`${s.title} ${s.description} ${s.code}`);
      if (tokens.some((t) => t === qt || t.includes(qt))) df += 1;
    }
    // Robertson-Sparck-Jones IDF: rare query terms (e.g. "useEffect") outweigh
    // terms that appear in every snippet (e.g. the library name).
    idf.set(qt, Math.log((N - df + 0.5) / (df + 0.5) + 1));
  }
  return idf;
}

function scoreSnippet(snippet: Snippet, queryTokens: string[], idf: Map<string, number>): number {
  if (queryTokens.length === 0) return 1;
  const titleTokens = tokenize(snippet.title);
  const descTokens = tokenize(snippet.description);
  const codeTokens = tokenize(snippet.code);
  let score = 0;
  for (const qt of queryTokens) {
    // base 1 + IDF: never reduces a match below its prior weight, only boosts
    // discriminative terms, so matched snippets always keep score > 0.
    const w = 1 + (idf.get(qt) ?? 0);
    if (titleTokens.some((t) => t === qt)) score += 12 * w;
    else if (titleTokens.some((t) => t.includes(qt))) score += 6 * w;
    if (descTokens.includes(qt)) score += 4 * w;
    if (codeTokens.includes(qt)) score += 3 * w;
  }
  // Quality bonuses only apply when the query actually matched something — otherwise
  // every snippet would tie with score=2 and pass the "score > 0" filter.
  if (score > 0) {
    if (snippet.language && snippet.language !== "text") score += 1;
    if (snippet.description.length > 0) score += 1;
  }
  return score;
}

/**
 * Rank snippets by topic relevance and optional language filter.
 * Snippets with score 0 are dropped unless topic is empty.
 */
export function rankSnippets(
  snippets: Snippet[],
  topic: string,
  language?: string,
  max = 10,
): Snippet[] {
  const filtered = language
    ? snippets.filter((s) => s.language === normalizeLanguage(language))
    : snippets;

  const queryTokens = tokenize(topic);
  const idf = buildSnippetIDF(filtered, queryTokens);

  const scored = filtered.map((s) => ({
    ...s,
    score: scoreSnippet(s, queryTokens, idf),
  }));

  const ranked = queryTokens.length === 0
    ? scored
    : scored.filter((s) => s.score > 0);

  ranked.sort((a, b) => b.score - a.score);
  return ranked.slice(0, max);
}

/**
 * Render snippets as a markdown response (one entry per snippet) plus a structured
 * representation suitable for tool output's structuredContent field.
 */
export function renderSnippets(snippets: Snippet[]): string {
  if (snippets.length === 0) {
    return "No matching snippets found. Try a broader topic or remove the language filter.";
  }
  const lines: string[] = [`Found ${snippets.length} snippet${snippets.length > 1 ? "s" : ""}.`, ""];
  for (const s of snippets) {
    lines.push(`### ${s.title}`);
    if (s.description) lines.push(s.description);
    lines.push(`Language: \`${s.language}\``);
    lines.push("");
    lines.push("```" + s.language);
    lines.push(s.code);
    lines.push("```");
    lines.push(`Source: ${s.source}`);
    lines.push("");
  }
  return lines.join("\n");
}
