import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { readProjectFiles } from "./audit-scan.js";

let root = "";

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), "audit-scan-"));
  await mkdir(join(root, "sub", "deep"), { recursive: true });
  await mkdir(join(root, "node_modules"), { recursive: true });
  for (const name of ["a.ts", "b.tsx", "c.css", "d.py"]) await writeFile(join(root, name), `// ${name}\n`);
  for (const name of ["s1.ts", "s2.ts"]) await writeFile(join(root, "sub", name), `// ${name}\n`);
  await writeFile(join(root, "sub", "deep", "x.vue"), "<template />\n");
  await writeFile(join(root, "node_modules", "dep.js"), "skip\n");
  await writeFile(join(root, "notes.md"), "skip\n");
  await writeFile(join(root, "huge.js"), "x".repeat(200_001));
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

describe("readProjectFiles", () => {
  it("reads source files with content, skipping ignored dirs, other extensions and oversized files", async () => {
    const files = await readProjectFiles(root, 100);
    expect(files.map((f) => f.path).sort()).toEqual(
      ["a.ts", "b.tsx", "c.css", "d.py", "sub/deep/x.vue", "sub/s1.ts", "sub/s2.ts"].sort(),
    );
    expect(files.find((f) => f.path === "a.ts")?.content).toBe("// a.ts\n");
  });

  it("stops at maxFiles at the same point a full scan reaches it", async () => {
    const all = (await readProjectFiles(root, 100)).map((f) => f.path);
    for (let max = 1; max <= all.length; max++) {
      const capped = (await readProjectFiles(root, max)).map((f) => f.path);
      expect(capped).toEqual(all.slice(0, max));
    }
  });

  it("returns nothing for a missing directory", async () => {
    expect(await readProjectFiles(join(root, "nope"), 10)).toEqual([]);
  });
});
