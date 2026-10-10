import { describe, it, expect } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Spawns the real bootstrap, so routing is checked as an MCP client or a shell sees it.
const entry = fileURLToPath(new URL("./index.ts", import.meta.url));
const env = { ...process.env, NODE_DISABLE_COMPILE_CACHE: "1", GT_NO_WATERMARK: "1" };
const run = (...args: string[]) =>
  spawnSync(process.execPath, ["--import", "tsx", entry, ...args], { env, encoding: "utf8", timeout: 30_000 });

/** Start the entry with piped stdin, send initialize, resolve with the first stdout line. */
function initialize(...args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", "tsx", entry, ...args], { env, stdio: ["pipe", "pipe", "ignore"] });
    let buf = "";
    const timer = setTimeout(() => { child.kill(); reject(new Error(`no initialize response: ${buf}`)); }, 30_000);
    child.stdout.on("data", (d: Buffer) => {
      buf += d.toString();
      const line = buf.split("\n")[0];
      if (buf.includes("\n") && line !== undefined) { clearTimeout(timer); child.kill(); resolve(line); }
    });
    child.stdin.write(JSON.stringify({
      jsonrpc: "2.0", id: 1, method: "initialize",
      params: { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "test", version: "1" } },
    }) + "\n");
  });
}

describe("index.ts entry routing", () => {
  it("no arguments: stdio MCP server answers initialize", async () => {
    const line = await initialize();
    expect(JSON.parse(line)).toMatchObject({ id: 1, result: { serverInfo: { name: "GroundTruth" } } });
  }, 40_000);

  it("unknown bare word with piped stdin still runs the server", async () => {
    const line = await initialize("frobnicate");
    expect(JSON.parse(line)).toMatchObject({ id: 1, result: { protocolVersion: "2025-11-25" } });
  }, 40_000);

  it("--version and --help answer without starting the server", () => {
    const version = run("--version");
    expect(version.status).toBe(0);
    expect(version.stdout).toMatch(/^GroundTruth v\d+\.\d+\.\d+\n$/);
    const help = run("--help");
    expect(help.status).toBe(0);
    expect(help.stdout).toContain("Commands:");
  }, 40_000);

  it("a command runs one tool, prints plain text and exits 0", () => {
    const r = run("resolve", "react");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("facebook/react");
    expect(r.stderr).toBe("");
  }, 40_000);

  it("a usage error exits 2 with a message on stderr only", () => {
    const r = run("search");
    expect(r.status).toBe(2);
    expect(r.stdout).toBe("");
    expect(r.stderr).toMatch(/^gt-mcp: missing <query>/);
  }, 40_000);

  it("an invalid GT_* variable in command mode exits 2", () => {
    const r = spawnSync(process.execPath, ["--import", "tsx", entry, "resolve", "react"],
      { env: { ...env, GT_TOOL_TIMEOUT_MS: "nope" }, encoding: "utf8", timeout: 30_000 });
    expect(r.status).toBe(2);
    expect(r.stderr).toMatch(/^gt-mcp: .*GT_TOOL_TIMEOUT_MS/);
  }, 40_000);
});
