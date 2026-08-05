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
  describe("composer.json", () => {
    it("reads require and require-dev, strips vendor prefix", async () => {
      await withTempDir(
        {
          "composer.json": JSON.stringify({
            require: {
              "php": "^8.1",
              "laravel/framework": "^10.0",
              "ext-json": "*",
            },
            "require-dev": {
              "phpunit/phpunit": "^10.0",
            },
          }),
        },
        async (dir) => {
          const result = await detectDependencies(dir);
          const src = result.find((s) => s.file === "composer.json");
          expect(src).toBeDefined();
          // vendor prefix stripped: "laravel/framework" -> "framework"
          expect(src!.dependencies).toContain("framework");
          expect(src!.dependencies).toContain("phpunit");
          // php and ext-* excluded
          expect(src!.dependencies).not.toContain("php");
          expect(src!.dependencies).not.toContain("ext-json");
        },
      );
    });
  });

  // ── build.gradle ─────────────────────────────────────────────────────────

  describe("build.gradle", () => {
    it("reads implementation and api dependencies", async () => {
      await withTempDir(
        {
          "build.gradle": `
plugins {
  id 'com.android.application'
}

dependencies {
  implementation("com.squareup.retrofit2:retrofit:2.9.0")
  implementation("com.squareup.okhttp3:okhttp:4.11.0")
  api("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.7.3")
  testImplementation("junit:junit:4.13.2")
}
`,
        },
        async (dir) => {
          const result = await detectDependencies(dir);
          const src = result.find((s) => s.file === "build.gradle");
          expect(src).toBeDefined();
          expect(src!.dependencies).toContain("retrofit");
          expect(src!.dependencies).toContain("okhttp");
          expect(src!.dependencies).toContain("kotlinx-coroutines-android");
          expect(src!.dependencies).toContain("junit");
        },
      );
    });

    it("reads build.gradle.kts if build.gradle is absent", async () => {
      await withTempDir(
        {
          "build.gradle.kts": `
dependencies {
  implementation("com.squareup.retrofit2:retrofit:2.9.0")
}
`,
        },
        async (dir) => {
          const result = await detectDependencies(dir);
          const src = result.find((s) => s.file === "build.gradle.kts");
          expect(src).toBeDefined();
          expect(src!.dependencies).toContain("retrofit");
        },
      );
    });
  });

  // ── multiple manifest files ───────────────────────────────────────────────

  it("returns multiple sources when both package.json and requirements.txt exist", async () => {
    await withTempDir(
      {
        "package.json": JSON.stringify({ dependencies: { react: "^18" } }),
        "requirements.txt": "flask\n",
      },
      async (dir) => {
        const result = await detectDependencies(dir);
        expect(result.length).toBeGreaterThanOrEqual(2);
        const files = result.map((s) => s.file);
        expect(files).toContain("package.json");
        expect(files).toContain("requirements.txt");
      },
    );
  });
});
