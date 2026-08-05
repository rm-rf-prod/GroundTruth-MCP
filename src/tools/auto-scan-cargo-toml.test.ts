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
  describe("Cargo.toml", () => {
    it("reads [dependencies] section", async () => {
      await withTempDir(
        {
          "Cargo.toml": `
[package]
name = "my-crate"
version = "0.1.0"

[dependencies]
serde = { version = "1.0", features = ["derive"] }
tokio = "1"
reqwest = "0.11"
`,
        },
        async (dir) => {
          const result = await detectDependencies(dir);
          const src = result.find((s) => s.file === "Cargo.toml");
          expect(src).toBeDefined();
          expect(src!.dependencies).toContain("serde");
          expect(src!.dependencies).toContain("tokio");
          expect(src!.dependencies).toContain("reqwest");
        },
      );
    });

    it("skips malformed or empty [dependencies]", async () => {
      await withTempDir(
        {
          "Cargo.toml": `
[package]
name = "my-crate"
`,
        },
        async (dir) => {
          const result = await detectDependencies(dir);
          expect(result.find((s) => s.file === "Cargo.toml")).toBeUndefined();
        },
      );
    });
  });

  // ── go.mod ───────────────────────────────────────────────────────────────

  describe("go.mod", () => {
    it("reads require block and extracts last path segment", async () => {
      await withTempDir(
        {
          "go.mod": `
module github.com/example/myapp

go 1.21

require (
  github.com/gin-gonic/gin v1.9.1
  github.com/go-gorm/gorm v1.25.0
  golang.org/x/crypto v0.17.0
)
`,
        },
        async (dir) => {
          const result = await detectDependencies(dir);
          const src = result.find((s) => s.file === "go.mod");
          expect(src).toBeDefined();
          expect(src!.dependencies).toContain("gin");
          expect(src!.dependencies).toContain("gorm");
          expect(src!.dependencies).toContain("crypto");
        },
      );
    });

    it("skips comment lines inside require block", async () => {
      await withTempDir(
        {
          "go.mod": `
module example.com/myapp
go 1.21
require (
  // indirect
  github.com/pkg/errors v0.9.1
)
`,
        },
        async (dir) => {
          const result = await detectDependencies(dir);
          const src = result.find((s) => s.file === "go.mod");
          // "errors" should be present, "//" comment should not be a dep
          expect(src!.dependencies).not.toContain("//");
        },
      );
    });

    it("reads single-line require directives alongside block form", async () => {
      await withTempDir(
        {
          "go.mod": `
module github.com/example/myapp

go 1.21

require (
  github.com/gin-gonic/gin v1.9.1
  github.com/go-gorm/gorm v1.25.0
)

require github.com/pkg/errors v0.9.1

require golang.org/x/crypto v0.17.0
`,
        },
        async (dir) => {
          const result = await detectDependencies(dir);
          const src = result.find((s) => s.file === "go.mod");
          expect(src).toBeDefined();
          // block-form deps
          expect(src!.dependencies).toContain("gin");
          expect(src!.dependencies).toContain("gorm");
          // single-line form deps
          expect(src!.dependencies).toContain("errors");
          expect(src!.dependencies).toContain("crypto");
          // deduplication: each name appears at most once
          const ginCount = src!.dependencies.filter((d) => d === "gin").length;
          expect(ginCount).toBe(1);
        },
      );
    });
  });

  // ── pom.xml ──────────────────────────────────────────────────────────────

  describe("pom.xml", () => {
    it("reads <artifactId> from <dependency> blocks", async () => {
      await withTempDir(
        {
          "pom.xml": `
<project>
  <dependencies>
    <dependency>
      <groupId>org.springframework.boot</groupId>
      <artifactId>spring-boot-starter-web</artifactId>
      <version>5.2.0</version>
    </dependency>
    <dependency>
      <groupId>com.fasterxml.jackson.core</groupId>
      <artifactId>jackson-databind</artifactId>
    </dependency>
  </dependencies>
</project>
`,
        },
        async (dir) => {
          const result = await detectDependencies(dir);
          const src = result.find((s) => s.file === "pom.xml");
          expect(src).toBeDefined();
          expect(src!.dependencies).toContain("spring-boot-starter-web");
          expect(src!.dependencies).toContain("jackson-databind");
        },
      );
    });
  });

  // ── composer.json ────────────────────────────────────────────────────────

});
