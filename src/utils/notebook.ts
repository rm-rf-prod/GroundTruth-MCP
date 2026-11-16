/**
 * Jupyter notebook (.ipynb) reader. Only code-cell sources are ever returned:
 * the raw JSON holds outputs (base64 images, tracebacks) that would trip the
 * secret and injection patterns and are not the user's code.
 */

/** Notebooks with embedded outputs dwarf their code; only the code is kept, so the cap is far above 200 KB. */
export const NOTEBOOK_MAX_BYTES = 5_000_000;

/** Caps on extracted code per notebook. */
export const NOTEBOOK_MAX_CODE_CHARS = 200_000;
export const NOTEBOOK_MAX_CODE_LINES = 20_000;

export interface NotebookSource {
  /** Every code cell joined by newlines, magic lines blanked so line numbers stay stable. */
  content: string;
  /** Per content line: 1-based code-cell index and 1-based line within that cell. */
  lineMap: Array<[cell: number, line: number]>;
}

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** nbformat stores multiline text as one string or as an array to concatenate. */
function sourceText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value) && value.every((part) => typeof part === "string")) return value.join("");
  return "";
}

/** Kernel language from kernelspec or language_info; undefined means unknown (treated as Python). */
function kernelLanguage(metadata: unknown): string | undefined {
  if (!isObject(metadata)) return undefined;
  const candidates = [
    isObject(metadata.kernelspec) ? metadata.kernelspec.language : undefined,
    isObject(metadata.language_info) ? metadata.language_info.name : undefined,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate !== "") return candidate.toLowerCase();
  }
  return undefined;
}

/**
 * Code-cell sources of a Python notebook, in order (markdown and raw cells are
 * dropped). Null when the JSON is malformed, is not a notebook, or the kernel
 * language is set and is not Python. Never throws.
 */
export function parseNotebook(raw: string): string[] | null {
  let notebook: unknown;
  try {
    notebook = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObject(notebook)) return null;
  const language = kernelLanguage(notebook.metadata);
  if (language !== undefined && !language.startsWith("python")) return null;

  // nbformat 4: cells[] with `source`. nbformat 3: worksheets[].cells[] with `input`.
  let cells: unknown[];
  if (Array.isArray(notebook.cells)) {
    cells = notebook.cells;
  } else if (Array.isArray(notebook.worksheets)) {
    cells = notebook.worksheets.flatMap((sheet: unknown) => (isObject(sheet) && Array.isArray(sheet.cells) ? sheet.cells : []));
  } else {
    return null;
  }
  return cells.filter(isObject).filter((cell) => cell.cell_type === "code").map((cell) => sourceText(cell.source ?? cell.input));
}

// shortcut: only the magic line is blanked; the body of a %%bash or %%html cell is still scanned. Upgrade if shell cells cause noise.
const MAGIC_LINE = /^\s*[%!]/;

/** Join code cells into one auditable text, blanking IPython magic and shell lines. */
export function flattenNotebook(cells: string[]): NotebookSource {
  const lines: string[] = [];
  const lineMap: NotebookSource["lineMap"] = [];
  let chars = 0;
  // Stops at the cap so a hostile notebook cannot explode memory.
  for (const [cellIndex, source] of cells.entries()) {
    for (const [lineIndex, line] of source.split(/\r?\n/).entries()) {
      if (chars > NOTEBOOK_MAX_CODE_CHARS || lines.length >= NOTEBOOK_MAX_CODE_LINES) return { content: lines.join("\n"), lineMap };
      lines.push(MAGIC_LINE.test(line) ? "" : line);
      lineMap.push([cellIndex + 1, lineIndex + 1]);
      chars += line.length + 1;
    }
  }
  return { content: lines.join("\n"), lineMap };
}
