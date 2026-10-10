import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DiskCache } from "../services/disk-cache.js";

const state = vi.hoisted(() => ({ dir: "" }));

// A tool that, like doc-fetch and request.ts, starts a cache write and returns
// without awaiting it.
vi.mock("./session.js", () => ({
  RpcError: class RpcError extends Error {},
  openSession: async () => ({
    tools: [],
    call: async () => {
      void new DiskCache(state.dir).set("doc", "x".repeat(100_000));
      return { content: [{ type: "text", text: "ok" }] };
    },
    close: async () => {},
  }),
}));

const { runCli } = await import("./run.js");

beforeEach(async () => { state.dir = await mkdtemp(join(tmpdir(), "gt-run-flush-")); });
afterEach(async () => { await rm(state.dir, { recursive: true, force: true }); });

describe("runCli disk-cache flush", () => {
  it("persists a tool's fire-and-forget cache write before returning", async () => {
    const r = await runCli(["call", "gt_get_docs", "{}"]);
    expect(r.code).toBe(0);
    const files = await readdir(state.dir);
    expect(files.filter((f) => f.endsWith(".json"))).toHaveLength(1);
    expect(files.filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });
});
