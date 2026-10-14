import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { extractNotebookCode, readProjectFiles, runPatterns } from "./audit-scan.js";

describe("extractNotebookCode", () => {
  it("extracts code cells and prefixes with cell markers", () => {
    const notebook = {
      cells: [
        {
          cell_type: "markdown",
          source: ["# Title\n", "Description text\n"],
        },
        {
          cell_type: "code",
          source: ["import os\n", "print(os.getcwd())\n"],
        },
      ],
      metadata: {},
      nbformat: 4,
      nbformat_minor: 2,
    };

    const code = extractNotebookCode(JSON.stringify(notebook));
    expect(code).toBe(
      "# %% [code cell 2]\nimport os\nprint(os.getcwd())",
    );
  });

  it("handles string source format and multiple code cells", () => {
    const notebook = {
      cells: [
        {
          cell_type: "code",
          source: "x = 1\ny = 2",
        },
        {
          cell_type: "raw",
          source: "raw content",
        },
        {
          cell_type: "code",
          source: "print(x + y)",
        },
      ],
      metadata: {},
      nbformat: 4,
      nbformat_minor: 2,
    };

    const code = extractNotebookCode(JSON.stringify(notebook));
    expect(code).toBe(
      "# %% [code cell 1]\nx = 1\ny = 2\n# %% [code cell 3]\nprint(x + y)",
    );
  });

  it("comments out IPython magics (%...) and shell escapes (!...)", () => {
    const notebook = {
      cells: [
        {
          cell_type: "code",
          source: [
            "%matplotlib inline\n",
            "!pip install pandas\n",
            "import pandas as pd\n",
          ],
        },
      ],
    };

    const code = extractNotebookCode(JSON.stringify(notebook));
    expect(code).toBe(
      "# %% [code cell 1]\n# %matplotlib inline\n# !pip install pandas\nimport pandas as pd",
    );
  });

  it("returns null for malformed JSON or invalid notebook structures", () => {
    expect(extractNotebookCode("not json")).toBeNull();
    expect(extractNotebookCode("{}")).toBeNull();
    expect(extractNotebookCode(JSON.stringify({ cells: "not an array" }))).toBeNull();
  });
});

describe("readProjectFiles with .ipynb", () => {
  let root = "";

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "audit-ipynb-"));
    await mkdir(join(root, ".ipynb_checkpoints"), { recursive: true });

    const validNotebook = {
      cells: [
        {
          cell_type: "code",
          source: [
            "import os\n",
            "eval('1 + 1')\n",
            "os.system('ls')\n",
          ],
        },
      ],
    };

    await writeFile(join(root, "pipeline.ipynb"), JSON.stringify(validNotebook));
    await writeFile(
      join(root, ".ipynb_checkpoints", "pipeline-checkpoint.ipynb"),
      JSON.stringify(validNotebook),
    );
    await writeFile(
      join(root, "stray-checkpoint.ipynb"),
      JSON.stringify(validNotebook),
    );
    // Oversized notebook (> 2MB)
    await writeFile(join(root, "oversized.ipynb"), "x".repeat(2_000_001));
  });

  afterAll(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("includes .ipynb and extracts code while skipping checkpoints and oversized files", async () => {
    const files = await readProjectFiles(root, 50);
    const paths = files.map((f) => f.path);

    expect(paths).toContain("pipeline.ipynb");
    expect(paths).not.toContain(".ipynb_checkpoints/pipeline-checkpoint.ipynb");
    expect(paths).not.toContain("stray-checkpoint.ipynb");
    expect(paths).not.toContain("oversized.ipynb");

    const nbFile = files.find((f) => f.path === "pipeline.ipynb");
    expect(nbFile?.content).toContain("eval('1 + 1')");
  });

  it("detects security and Python-specific issues in notebook code cells", async () => {
    const files = await readProjectFiles(root, 50);

    // With "all" categories: flags dynamic code execution (security) and os.system (python)
    const allIssues = runPatterns(files, ["all"]);
    const secIssue = allIssues.find(
      (i) => i.file === "pipeline.ipynb" && i.category === "security",
    );
    expect(secIssue).toBeDefined();
    expect(secIssue?.line).toBe(3); // Line 1: # %%, Line 2: import os, Line 3: eval('1 + 1')

    const pyIssue = allIssues.find(
      (i) => i.file === "pipeline.ipynb" && i.title.includes("os.system"),
    );
    expect(pyIssue).toBeDefined();
    expect(pyIssue?.category).toBe("python");
    expect(pyIssue?.line).toBe(4);

    // With "python" category: flags eval() as python category
    const pyOnlyIssues = runPatterns(files, ["python"]);
    const evalPyIssue = pyOnlyIssues.find(
      (i) => i.file === "pipeline.ipynb" && i.title.includes("eval()"),
    );
    expect(evalPyIssue).toBeDefined();
    expect(evalPyIssue?.category).toBe("python");
    expect(evalPyIssue?.line).toBe(3);
  });
});
