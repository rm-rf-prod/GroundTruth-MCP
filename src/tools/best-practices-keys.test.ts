import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { lookupById } from "../sources/registry.js";

/**
 * BEST_PRACTICES_URLS is keyed by registry id and read with a case-sensitive
 * `Map.get`. A key that matches no entry is unreachable dead data: the curated
 * pages silently never serve, and the tool falls through to generic discovery.
 * 62 of 231 keys had rotted this way before this guard existed.
 *
 * Keys are read from source rather than imported so the check stays independent
 * of the tool's test mocks.
 */
const SOURCE = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "..", "sources", "best-practice-urls.ts"),
  "utf8",
);

const KEYS = [...SOURCE.matchAll(/^ {2}"([^"]+)": \[/gm)].map((m) => m[1] ?? "");

describe("BEST_PRACTICES_URLS keys", () => {
  it("finds the map (guards against the regex silently matching nothing)", () => {
    expect(KEYS.length).toBeGreaterThan(150);
  });

  it("every key resolves to a registry entry", () => {
    const dead = KEYS.filter((k) => !lookupById(k));
    expect(dead, `unresolvable BEST_PRACTICES_URLS keys: ${dead.join(", ")}`).toEqual([]);
  });

  it("has no duplicate keys", () => {
    const seen = new Set<string>();
    const dupes = KEYS.filter((k) => (seen.has(k) ? true : (seen.add(k), false)));
    expect(dupes).toEqual([]);
  });
});
