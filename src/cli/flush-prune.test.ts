import { describe, it, expect, vi, afterAll } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, utimesSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// diskDocCache reads GT_CACHE_DIR once, at import.
const dir = mkdtempSync(join(tmpdir(), "gt-flush-prune-"));
vi.stubEnv("GT_CACHE_DIR", dir);
const { pruneInBackground, flushDiskWrites } = await import("./flush.js");

afterAll(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

describe("CLI background prune", () => {
  it("returns at once, and the exit flush lets it finish removing orphaned tmp files", async () => {
    const orphan = join(dir, "x.json.abc.tmp");
    writeFileSync(orphan, "{");
    const old = (Date.now() - 30 * 60_000) / 1000;
    utimesSync(orphan, old, old);

    expect(pruneInBackground()).toBeUndefined();
    await flushDiskWrites();

    expect(readdirSync(dir)).toEqual([]);
  });
});
