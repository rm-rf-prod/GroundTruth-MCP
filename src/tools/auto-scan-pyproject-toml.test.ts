import { describe, it, expect, afterEach } from "vitest";
import { mkdtemp, writeFile, rm } from "fs/promises";
import { join } from "path";
import { tmpdir } from "os";
import { detectDependencies } from "./auto-scan.js";

// Helper: create a temp dir, write files, return the dir path
async function withTempDir(
  files: Record<string, string>,
  fn: (dir: string) => Promise<void>,
): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "gt-mcp-test-"));
  try {
    for (const [name, content] of Object.entries(files)) {
      await writeFile(join(dir, name), content, "utf-8");
    }
    await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("detectDependencies", () => {
  describe("pyproject.toml", () => {
    it("reads Poetry [tool.poetry.dependencies]", async () => {
      await withTempDir(
        {
          "pyproject.toml": `
[tool.poetry]
name = "my-app"

[tool.poetry.dependencies]
python = "^3.11"
flask = "^2.3"
sqlalchemy = "^2.0"
`,
        },
        async (dir) => {
          const result = await detectDependencies(dir);
          const src = result.find((s) => s.file === "pyproject.toml");
          expect(src).toBeDefined();
          expect(src!.dependencies).toContain("flask");
          expect(src!.dependencies).toContain("sqlalchemy");
          // "python" is excluded
          expect(src!.dependencies).not.toContain("python");
        },
      );
    });

    it("reads PEP 517 [project.dependencies] array", async () => {
      await withTempDir(
        {
          "pyproject.toml": `
[project]
name = "my-app"
dependencies = [
  "fastapi>=0.100",
  "pydantic>=2.0",
  "uvicorn[standard]",
]
`,
        },
        async (dir) => {
          const result = await detectDependencies(dir);
          const src = result.find((s) => s.file === "pyproject.toml");
          expect(src).toBeDefined();
          expect(src!.dependencies).toContain("fastapi");
          expect(src!.dependencies).toContain("pydantic");
          expect(src!.dependencies).toContain("uvicorn");
        },
      );
    });

    it("deduplicates across sections", async () => {
      await withTempDir(
        {
          "pyproject.toml": `
[tool.poetry.dependencies]
python = "^3.11"
flask = "^2.3"

[tool.poetry.dev-dependencies]
pytest = "^7.0"
flask = "^2.3"
`,
        },
        async (dir) => {
          const result = await detectDependencies(dir);
          const src = result.find((s) => s.file === "pyproject.toml");
          const flaskCount = src!.dependencies.filter((d) => d === "flask").length;
          expect(flaskCount).toBe(1);
        },
      );
    });

    it("reads Poetry [tool.poetry.dev-dependencies]", async () => {
      await withTempDir(
        {
          "pyproject.toml": `
[tool.poetry]
name = "my-app"

[tool.poetry.dependencies]
python = "^3.11"
flask = "^2.3"

[tool.poetry.dev-dependencies]
pytest = "^7.0"
black = "^23.0"
`,
        },
        async (dir) => {
          const result = await detectDependencies(dir);
          const src = result.find((s) => s.file === "pyproject.toml");
          expect(src).toBeDefined();
          expect(src!.dependencies).toContain("pytest");
          expect(src!.dependencies).toContain("black");
          // python excluded, flask still present
          expect(src!.dependencies).toContain("flask");
          expect(src!.dependencies).not.toContain("python");
        },
      );
    });

    it("reads PEP 735 [dependency-groups]", async () => {
      await withTempDir(
        {
          "pyproject.toml": `
[project]
name = "my-app"
dependencies = ["httpx>=0.24"]

[dependency-groups]
dev = [
  "pytest>=7.0",
  "black>=23.0",
]
test = [
  "coverage>=7.0",
]
`,
        },
        async (dir) => {
          const result = await detectDependencies(dir);
          const src = result.find((s) => s.file === "pyproject.toml");
          expect(src).toBeDefined();
          expect(src!.dependencies).toContain("pytest");
          expect(src!.dependencies).toContain("black");
          expect(src!.dependencies).toContain("coverage");
          expect(src!.dependencies).toContain("httpx");
        },
      );
    });
  });

  // ── Cargo.toml ───────────────────────────────────────────────────────────

});
