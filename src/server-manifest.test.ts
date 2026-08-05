import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { SERVER_VERSION } from "./constants.js";

/**
 * server.json is the MCP registry manifest. The registry validates it server-side
 * and rejects the whole publish on any violation, which fails the release job
 * AFTER npm has already published — a split release that has to be chased by hand.
 * These assertions catch the same violations locally, before the tag exists.
 */
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(root, "server.json"), "utf8")) as {
  name: string;
  description: string;
  version: string;
  packages: Array<{ identifier: string; version: string; registryType: string }>;
};
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
  name: string;
  version: string;
};

/** Enforced by registry.modelcontextprotocol.io — a longer value returns HTTP 422. */
const MAX_DESCRIPTION_LENGTH = 100;

describe("server.json (MCP registry manifest)", () => {
  it("keeps the description within the registry's length limit", () => {
    expect(
      manifest.description.length,
      `description is ${manifest.description.length} chars, limit is ${MAX_DESCRIPTION_LENGTH}`,
    ).toBeLessThanOrEqual(MAX_DESCRIPTION_LENGTH);
  });

  it("has a non-empty description", () => {
    expect(manifest.description.trim().length).toBeGreaterThan(0);
  });

  it("matches the package version", () => {
    expect(manifest.version).toBe(pkg.version);
  });

  it("pins every package entry to the same version", () => {
    for (const entry of manifest.packages) {
      expect(entry.version, `packages[${entry.identifier}].version`).toBe(pkg.version);
    }
  });

  it("points at the published npm package", () => {
    const npmEntry = manifest.packages.find((p) => p.registryType === "npm");
    expect(npmEntry?.identifier).toBe(pkg.name);
  });

  it("agrees with SERVER_VERSION in constants.ts", () => {
    expect(manifest.version).toBe(SERVER_VERSION);
  });
});
