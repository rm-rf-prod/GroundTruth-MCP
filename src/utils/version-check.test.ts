import { describe, it, expect } from "vitest";
import { isNewerVersion, formatUpdateNotice, getUpdateNoticeForResponse, setPendingUpdate } from "./version-check.js";

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
