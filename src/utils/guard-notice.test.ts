import { describe, it, expect, afterEach, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function load(env: Record<string, string> = {}) {
  vi.resetModules();
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  const guard = await import("./guard.js");
  const versionCheck = await import("./version-check.js");
  return { ...guard, ...versionCheck };
}

describe("per-response notice", () => {
  it("keeps the owner-approved license notice wording", async () => {
    const { IP_NOTICE } = await load();
    expect(IP_NOTICE).toBe(
      "[gt-mcp — Elastic License 2.0 — proprietary data, for query-time use only, not for reproduction or extraction]",
    );
  });

  it("appends a pending update notice by default", async () => {
    const { withNotice, setPendingUpdate } = await load({ GT_NO_WATERMARK: "1" });
    setPendingUpdate("99.0.0");
    expect(withNotice("body")).toContain("UPDATE AVAILABLE");
  });

  it("drops the update notice when GT_NO_UPDATE_CHECK=1", async () => {
    const { withNotice, setPendingUpdate } = await load({ GT_NO_WATERMARK: "1", GT_NO_UPDATE_CHECK: "1" });
    setPendingUpdate("99.0.0");
    expect(withNotice("body")).not.toContain("UPDATE AVAILABLE");
  });
});
