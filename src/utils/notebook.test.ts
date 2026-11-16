import { describe, it, expect } from "vitest";
import { parseNotebook, flattenNotebook } from "./notebook.js";

const nb = (extra: Record<string, unknown>): string => JSON.stringify({ nbformat: 4, nbformat_minor: 5, ...extra });
const code = (source: string | string[], extra: Record<string, unknown> = {}) => ({ cell_type: "code", source, outputs: [], ...extra });

describe("parseNotebook", () => {
  it("reads nbformat 4 code cells with string and array sources, skipping markdown and raw cells", () => {
    const raw = nb({
      metadata: { kernelspec: { language: "python", name: "python3" } },
      cells: [
        { cell_type: "markdown", source: ["# title"] },
        code("a = 1\nb = 2"),
        { cell_type: "raw", source: "raw text" },
        code(["c = 3\n", "d = 4"]),
      ],
    });
    expect(parseNotebook(raw)).toEqual(["a = 1\nb = 2", "c = 3\nd = 4"]);
  });

  it("never returns outputs, only source", () => {
    const outputs = [{ output_type: "display_data", data: { "image/png": "QUtJQUlPU0ZPRE5ON0VYQU1QTEU=" } }];
    const result = parseNotebook(nb({ cells: [code("x = 1", { outputs })] }));
    expect(JSON.stringify(result)).toBe('["x = 1"]');
  });

  it("reads nbformat 3 worksheets with input", () => {
    const raw = JSON.stringify({
      nbformat: 3,
      worksheets: [
        { cells: [{ cell_type: "code", input: ["import os\n", "x = 1"] }, { cell_type: "markdown", source: "md" }] },
        { cells: [{ cell_type: "code", input: "y = 2" }] },
      ],
    });
    expect(parseNotebook(raw)).toEqual(["import os\nx = 1", "y = 2"]);
  });

  it("treats missing metadata as python", () => {
    expect(parseNotebook(nb({ cells: [code("x = 1")] }))).toEqual(["x = 1"]);
  });

  it("accepts language_info when kernelspec is absent", () => {
    expect(parseNotebook(nb({ metadata: { language_info: { name: "python" } }, cells: [code("x")] }))).toEqual(["x"]);
  });

  it.each([
    [{ kernelspec: { language: "R", name: "ir" } }],
    [{ language_info: { name: "julia" } }],
    [{ kernelspec: { language: "javascript" } }],
  ])("skips a notebook with a non-python kernel %j", (metadata) => {
    expect(parseNotebook(nb({ metadata, cells: [code("x = 1")] }))).toBeNull();
  });

  it.each([["not json"], [""], ["{"], ["[]"], ["null"], ["{}"], [JSON.stringify({ cells: "nope" })]])(
    "returns null for malformed input %j",
    (raw) => {
      expect(parseNotebook(raw)).toBeNull();
    },
  );

  it("keeps a code cell with an unusable source as an empty cell so indexes stay aligned", () => {
    expect(parseNotebook(nb({ cells: [code("a"), { cell_type: "code", source: 42 }, code("c")] }))).toEqual(["a", "", "c"]);
  });
});

describe("flattenNotebook", () => {
  it("blanks magic and shell lines without shifting line numbers", () => {
    const { content, lineMap } = flattenNotebook(["%matplotlib inline\nx = 1\n!ls -la\n  %time y = 2"]);
    expect(content.split("\n")).toEqual(["", "x = 1", "", ""]);
    expect(lineMap).toEqual([[1, 1], [1, 2], [1, 3], [1, 4]]);
  });

  it("maps each joined line back to its 1-based cell and line", () => {
    const { content, lineMap } = flattenNotebook(["a\nb", "c", "d\r\ne"]);
    expect(content).toBe("a\nb\nc\nd\ne");
    expect(lineMap).toEqual([[1, 1], [1, 2], [2, 1], [3, 1], [3, 2]]);
  });

  it("does not blank operators such as != inside a line", () => {
    expect(flattenNotebook(["a = b != c\nd = 5 % 2"]).content).toBe("a = b != c\nd = 5 % 2");
  });
});

describe("flattenNotebook caps", () => {
  it("stops at 200_000 chars", () => {
    const { content } = flattenNotebook(["x".repeat(1000) + "\n"].concat([]).concat(Array(1000).fill("y".repeat(1000))));
    expect(content.length).toBeLessThan(202_000);
  });

  it("stops at 20_000 lines", () => {
    const { lineMap } = flattenNotebook(["\n".repeat(50_000)]);
    expect(lineMap.length).toBe(20_000);
  });
});
