// node --test scripts/images/
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { verdict } from "./performance.mjs";
import { loadStats, loadBench, topEcosystems } from "./data.mjs";

test("verdict names the direction honestly", () => {
  const v = (m) => { const r = verdict(m); return `${r.factor} ${r.word}`; };
  assert.equal(v({ before: 810, after: 120, unit: "ms" }), "6.8x faster");
  assert.equal(v({ before: 46, after: 3.8, unit: "ms" }), "12x faster");
  assert.equal(v({ before: 100, after: 130, unit: "ms" }), "1.3x slower");
  assert.equal(v({ before: 182, after: 96, unit: "MB" }), "1.9x smaller");
  assert.equal(v({ before: 210, after: 1450, unit: "req/s", better: "higher" }), "6.9x higher");
  assert.equal(v({ before: 200, after: 100, unit: "req/s", better: "higher" }), "2.0x lower");
});

test("loadBench rejects malformed files", () => {
  const dir = mkdtempSync(join(tmpdir(), "gt-bench-"));
  const file = (o) => { const f = join(dir, `${Math.random()}.json`); writeFileSync(f, JSON.stringify(o)); return f; };
  assert.throws(() => loadBench(file({})), /non-empty array/);
  assert.throws(() => loadBench(file({ metrics: [{ label: "x", before: 0, after: 1, unit: "ms" }] })), /before/);
  assert.throws(() => loadBench(file({ metrics: [{ label: "x", before: 1, after: 1, unit: "ms", better: "up" }] })), /better/);
  assert.equal(loadBench(new URL("./bench.sample.json", import.meta.url).pathname).length, 5);
});

test("ecosystem rows come from the registry and keep ties together", () => {
  const stats = loadStats();
  assert.ok(stats.libraries > 0);
  assert.equal(stats.toolNames.length, stats.toolCount);
  const rows = topEcosystems(stats);
  const kept = rows.filter((r) => !r.other);
  const other = rows.find((r) => r.other);
  if (other) assert.notEqual(kept.at(-1).count, other.members[0].count, "a tie was split across Other");
  // Every library lands in at least one row.
  assert.ok(kept.reduce((s, r) => s + r.count, 0) + (other?.count ?? 0) >= stats.libraries);
});
