import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, writeFile, rm, mkdir, symlink } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { detectDependencies } from "./auto-scan.js";

const notebook = (cells: string[], language = "python"): string =>
  JSON.stringify({
    nbformat: 4,
    metadata: { kernelspec: { language } },
    cells: [{ cell_type: "markdown", source: ["import notcode"] }, ...cells.map((source) => ({ cell_type: "code", source, outputs: [] }))],
  });

const dirs: string[] = [];
async function project(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "gt-nb-deps-"));
  dirs.push(dir);
  for (const [name, content] of Object.entries(files)) await writeFile(join(dir, name), content, "utf-8");
  return dir;
}

afterEach(async () => {
  for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

describe("detectDependencies with notebooks", () => {
  it("lists pip install packages and registry-known imports, with no stdlib noise", async () => {
    const dir = await project({
      "analysis.ipynb": notebook([
        "%pip install -q seaborn==0.13 tqdm",
        "import os, re, json, sys\nfrom pathlib import Path\nfrom typing import Any\nimport numpy as np\nimport pandas as pd",
      ]),
    });
    const sources = await detectDependencies(dir);
    expect(sources).toEqual([{ file: "analysis.ipynb", dependencies: ["seaborn", "tqdm", "numpy", "pandas"] }]);
    const all = sources.flatMap((s) => s.dependencies);
    for (const stdlib of ["os", "re", "json", "sys", "pathlib", "typing"]) expect(all).not.toContain(stdlib);
  });

  it("ignores markdown cells, non-python notebooks, malformed notebooks and nested notebooks", async () => {
    const dir = await project({
      "r.ipynb": notebook(["%pip install shouldnotappear"], "R"),
      "broken.ipynb": "{ nope",
      "empty.ipynb": notebook(["x = 1"]),
    });
    await mkdir(join(dir, "nested"));
    await writeFile(join(dir, "nested", "deep.ipynb"), notebook(["%pip install nested-only"]));
    expect(await detectDependencies(dir)).toEqual([]);
  });

  it("reports notebooks after the manifests", async () => {
    const dir = await project({
      "requirements.txt": "flask\n",
      "nb.ipynb": notebook(["import pandas"]),
    });
    expect((await detectDependencies(dir)).map((s) => s.file)).toEqual(["requirements.txt", "nb.ipynb"]);
  });

  it("skips symlinked notebooks", async () => {
    const dir = await project({ "real.ipynb": notebook(["%pip install tqdm"]) });
    await symlink(join(dir, "real.ipynb"), join(dir, "link.ipynb"));
    expect((await detectDependencies(dir)).map((s) => s.file)).toEqual(["real.ipynb"]);
  });
});
