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
  it("returns empty array when no manifest files exist", async () => {
    await withTempDir({}, async (dir) => {
      const result = await detectDependencies(dir);
      expect(result).toHaveLength(0);
    });
  });

  // ── package.json ─────────────────────────────────────────────────────────

  describe("package.json", () => {
    it("reads production and dev dependencies", async () => {
      await withTempDir(
        {
          "package.json": JSON.stringify({
            dependencies: { react: "^18.0.0", "react-dom": "^18.0.0" },
            devDependencies: { vitest: "^5.2.0" },
          }),
        },
        async (dir) => {
          const result = await detectDependencies(dir);
          const src = result.find((s) => s.file === "package.json");
          expect(src).toBeDefined();
          expect(src!.dependencies).toContain("react");
          expect(src!.dependencies).toContain("react-dom");
          expect(src!.dependencies).toContain("vitest");
        },
      );
    });

    it("handles package.json with only devDependencies", async () => {
      await withTempDir(
        {
          "package.json": JSON.stringify({
            devDependencies: { typescript: "^5.2.0" },
          }),
        },
        async (dir) => {
          const result = await detectDependencies(dir);
          const src = result.find((s) => s.file === "package.json");
          expect(src).toBeDefined();
          expect(src!.dependencies).toContain("typescript");
        },
      );
    });

    it("skips package.json with no dependencies", async () => {
      await withTempDir(
        { "package.json": JSON.stringify({ name: "my-app", version: "1.0.0" }) },
        async (dir) => {
          const result = await detectDependencies(dir);
          expect(result.find((s) => s.file === "package.json")).toBeUndefined();
        },
      );
    });

    it("skips malformed package.json without throwing", async () => {
      await withTempDir(
        { "package.json": "{ this is not valid json" },
        async (dir) => {
          await expect(detectDependencies(dir)).resolves.not.toThrow();
          const result = await detectDependencies(dir);
          expect(result.find((s) => s.file === "package.json")).toBeUndefined();
        },
      );
    });
  });

  // ── requirements.txt ─────────────────────────────────────────────────────

  describe("requirements.txt", () => {
    it("reads plain package names", async () => {
      await withTempDir(
        {
          "requirements.txt": "flask\nrequests\nnumpy\n",
        },
        async (dir) => {
          const result = await detectDependencies(dir);
          const src = result.find((s) => s.file === "requirements.txt");
          expect(src).toBeDefined();
          expect(src!.dependencies).toContain("flask");
          expect(src!.dependencies).toContain("requests");
          expect(src!.dependencies).toContain("numpy");
        },
      );
    });

    it("strips version specifiers", async () => {
      await withTempDir(
        {
          "requirements.txt": "flask>=2.0\nrequests==2.28.0\nnumpy~=1.24\n",
        },
        async (dir) => {
          const result = await detectDependencies(dir);
          const src = result.find((s) => s.file === "requirements.txt");
          expect(src!.dependencies).toContain("flask");
          expect(src!.dependencies).toContain("requests");
          expect(src!.dependencies).toContain("numpy");
          // must not include version strings
          expect(src!.dependencies.join(" ")).not.toContain(">=");
          expect(src!.dependencies.join(" ")).not.toContain("==");
        },
      );
    });

    it("skips comment lines and flag lines", async () => {
      await withTempDir(
        {
          "requirements.txt": "# production deps\nflask\n-r other.txt\npytest\n",
        },
        async (dir) => {
          const result = await detectDependencies(dir);
          const src = result.find((s) => s.file === "requirements.txt");
          expect(src!.dependencies).toContain("flask");
          expect(src!.dependencies).toContain("pytest");
          expect(src!.dependencies).not.toContain("-r other.txt");
          expect(src!.dependencies.join(" ")).not.toContain("#");
        },
      );
    });
  });

  // ── pyproject.toml ───────────────────────────────────────────────────────

});
