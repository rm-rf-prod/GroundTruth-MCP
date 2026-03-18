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
  const dir = await mkdtemp(join(tmpdir(), "ws-mcp-test-"));
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
            devDependencies: { vitest: "^4.0.0" },
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
            devDependencies: { typescript: "^5.0.0" },
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
  });

  // ── Cargo.toml ───────────────────────────────────────────────────────────

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
      <version>3.1.0</version>
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
