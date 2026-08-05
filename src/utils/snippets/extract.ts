import type { Snippet } from "../../types.js";
import { createHash } from "crypto";

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

export function normalizeLanguage(raw: string): string {
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
      // CommonMark close: a fence run >= the opening length, same char, only
      // trailing spaces. startsWith() would wrongly close a 3-backtick block on
      // a nested 4-backtick line.
      const trimmedLine = line.trimEnd();
      const fenceChar = currentFence[0] ?? "`";
      const fenceRun = trimmedLine.match(new RegExp("^" + fenceChar.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "+"))?.[0] ?? "";
      if (fenceRun.length >= currentFence.length && trimmedLine.slice(fenceRun.length).trim() === "") {
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

