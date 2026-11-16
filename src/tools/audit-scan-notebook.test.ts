import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { readProjectFiles, runPatterns, groupIssues } from "./audit-scan.js";
import { issueLocation, renderAuditReport } from "./audit-report.js";
import { flattenNotebook } from "../utils/notebook.js";

const notebook = (cells: unknown[], extra: Record<string, unknown> = {}): string =>
  JSON.stringify({ nbformat: 4, nbformat_minor: 5, metadata: { kernelspec: { language: "python" } }, cells, ...extra });
const codeCell = (source: string[], outputs: unknown[] = []) => ({ cell_type: "code", source, outputs });

const bigOutput = { output_type: "display_data", data: { "image/png": "A".repeat(300_000) } };

let root = "";

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "audit-scan-nb-"));
  await mkdir(join(root, ".ipynb_checkpoints"), { recursive: true });
  await mkdir(join(root, "sub"), { recursive: true });
  await writeFile(join(root, "big.ipynb"), notebook([codeCell(["x = 1\n"], [bigOutput])]));
  await writeFile(join(root, "sub", "r.ipynb"), notebook([codeCell(["x <- 1"])], { metadata: { kernelspec: { language: "R" } } }));
  await writeFile(join(root, "broken.ipynb"), "{ not json");
  await writeFile(join(root, "too-big.ipynb"), "x".repeat(5_000_001));
  await writeFile(join(root, ".ipynb_checkpoints", "big-checkpoint.ipynb"), notebook([codeCell(["y = 2"])]));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("readProjectFiles with notebooks", () => {
  it("reads a notebook with outputs over 200 KB and keeps only its code", async () => {
    const files = await readProjectFiles(root, 100);
    const big = files.find((f) => f.path === "big.ipynb");
    expect(big?.content).toBe("x = 1\n");
    expect(big?.lineMap?.[0]).toEqual([1, 1]);
  });

  it("skips .ipynb_checkpoints, non-python kernels, malformed JSON and notebooks over the notebook cap", async () => {
    const paths = (await readProjectFiles(root, 100)).map((f) => f.path);
    expect(paths).toEqual(["big.ipynb"]);
  });
});

describe("runPatterns with notebooks", () => {
  const evalLine = ["result = ev", "al(user_input)"].join("");
  const file = {
    path: "analysis.ipynb",
    ...flattenNotebook(["import os\nprint('hi')", `a = 1\nb = 2\n${evalLine}`]),
  };

  it("maps an issue back to its code cell and the line inside that cell", () => {
    const issues = runPatterns([file], ["python"]);
    const hit = issues.find((i) => i.line === 3 && i.cell === 2);
    expect(hit).toBeDefined();
    expect(hit?.file).toBe("analysis.ipynb");
    expect(issueLocation(hit!)).toBe("analysis.ipynb:cell_2:line_3");
  });

  it("does not scan blanked magic lines", () => {
    const magic = { path: "m.ipynb", ...flattenNotebook([`!echo ${evalLine}\nx = 1`]) };
    expect(runPatterns([magic], ["python"])).toEqual([]);
  });

  it("leaves plain files on file:line", () => {
    const issues = runPatterns([{ path: "app.py", content: `x = 1\n${evalLine}\n` }], ["python"]);
    expect(issues).toHaveLength(1);
    expect(issues[0]?.cell).toBeUndefined();
    expect(issueLocation(issues[0]!)).toBe("app.py:2");
  });

  it("renders the notebook location in both text and structuredContent", () => {
    const issues = runPatterns([file], ["python"]);
    const report = renderAuditReport({ projectPath: "/p", filesScanned: 1, issues, grouped: groupIssues(issues), bpMap: new Map(), categories: ["python"] });
    expect(report.text).toContain("`analysis.ipynb:cell_2:line_3`");
    expect(report.structuredContent.issues.flatMap((i) => i.locations)).toContain("analysis.ipynb:cell_2:line_3");
  });
});

describe("readProjectFiles notebook concurrency", () => {
  it("returns many notebooks in listing order", async () => {
    const dir = await mkdtemp(join(tmpdir(), "audit-scan-many-"));
    try {
      for (let i = 0; i < 12; i++) await writeFile(join(dir, `n${String(i).padStart(2, "0")}.ipynb`), notebook([codeCell([`x = ${i}`])]));
      const files = await readProjectFiles(dir, 50);
      expect(files.map((f) => f.path)).toEqual(Array.from({ length: 12 }, (_, i) => `n${String(i).padStart(2, "0")}.ipynb`));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
