import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { helpText } from "./cli.js";

// Every GT_* name any source file reads: process.env.GT_X, process.env["GT_X"], or a
// quoted "GT_X" handed to a config helper. cli.ts is skipped: it is the list under test.
const srcDir = fileURLToPath(new URL("..", import.meta.url));
const sourceFiles = readdirSync(srcDir, { recursive: true, encoding: "utf8" })
  .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && f !== join("server", "cli.ts"));
const readVars = sourceFiles.flatMap((f) =>
  [...readFileSync(join(srcDir, f), "utf8").matchAll(/process\.env\.(GT_[A-Z_]+)|["'`](GT_[A-Z_]+)["'`]/g)]
    .map((m) => m[1] ?? m[2] ?? ""));
// Read by Node itself (module.enableCompileCache), not by our code.
const nodeVars = ["NODE_DISABLE_COMPILE_CACHE"];

const envSection = (): string[] => {
  const lines = helpText().split("\n");
  const start = lines.indexOf("Environment:");
  const end = lines.indexOf("", start);
  return lines.slice(start + 1, end);
};

describe("--help Environment section", () => {
  it("finds the env reads it guards", () => {
    expect(readVars).toContain("GT_CONCURRENCY");
    expect(readVars).toContain("GT_TOKEN_LIMIT");
  });

  it("documents every GT_* variable read anywhere under src/", () => {
    const documented = new Set(envSection().map((l) => l.trim().split(/\s+/)[0]));
    for (const name of new Set([...readVars, ...nodeVars])) expect(documented, name).toContain(name);
  });

  it("gives each variable a one-line meaning", () => {
    for (const line of envSection()) expect(line.trim().split(/\s{2,}/), line).toHaveLength(2);
  });

  it("keeps a Commands section", () => {
    expect(helpText()).toContain("Commands:");
  });
});
