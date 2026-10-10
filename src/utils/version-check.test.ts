import { describe, it, expect, vi } from "vitest";

const fetchWithTimeout = vi.hoisted(() => vi.fn());
vi.mock("../services/http/request.js", () => ({ fetchWithTimeout }));

import { isNewerVersion, formatUpdateNotice, getUpdateNoticeForResponse, setPendingUpdate, getLatestVersion } from "./version-check.js";

describe("isNewerVersion", () => {
  it("detects major version bump", () => {
    expect(isNewerVersion("3.0.3", "1.0.0")).toBe(true);
  });

  it("detects minor version bump", () => {
    expect(isNewerVersion("1.5.0", "1.4.0")).toBe(true);
  });

  it("detects patch version bump", () => {
    expect(isNewerVersion("1.4.2", "1.4.1")).toBe(true);
  });

  it("returns false when same version", () => {
    expect(isNewerVersion("1.4.1", "1.4.1")).toBe(false);
  });

  it("returns false when current is newer", () => {
    expect(isNewerVersion("1.3.0", "1.4.0")).toBe(false);
  });

  it("handles v prefix", () => {
    expect(isNewerVersion("v3.0.3", "v2.0.0")).toBe(true);
  });
});

describe("formatUpdateNotice", () => {
  it("includes the new version", () => {
    const notice = formatUpdateNotice("3.0.3");
    expect(notice).toContain("3.0.3");
    expect(notice).toContain("UPDATE AVAILABLE");
  });
});

describe("getUpdateNoticeForResponse", () => {
  it("returns empty when no update pending", () => {
    expect(getUpdateNoticeForResponse()).toBe("");
  });

  it("returns notice after setPendingUpdate", () => {
    setPendingUpdate("9.9.9");
    const notice = getUpdateNoticeForResponse();
    expect(notice).toContain("9.9.9");
    expect(notice).toContain("UPDATE AVAILABLE");
  });
});

describe("getLatestVersion", () => {
  it("goes through fetchWithTimeout, so the SSRF dispatcher guards the startup check too", async () => {
    fetchWithTimeout.mockResolvedValueOnce(new Response(JSON.stringify({ version: "99.0.0" })));
    expect(await getLatestVersion()).toBe("99.0.0");
    expect(fetchWithTimeout).toHaveBeenCalledWith(
      "https://registry.npmjs.org/@groundtruth-mcp/gt-mcp/latest",
      expect.any(Number),
      { Accept: "application/json" },
    );
  });
});
