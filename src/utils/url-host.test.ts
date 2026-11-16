import { describe, it, expect } from "vitest";
import { isHostOrSubdomain } from "./url-host.js";

describe("isHostOrSubdomain", () => {
  it("accepts the host and its subdomains", () => {
    expect(isHostOrSubdomain("https://github.com/o/r", "github.com")).toBe(true);
    expect(isHostOrSubdomain("https://www.github.com/o/r", "github.com")).toBe(true);
    expect(isHostOrSubdomain("https://developer.mozilla.org/x", "mozilla.org")).toBe(true);
  });

  it("rejects lookalike hosts", () => {
    expect(isHostOrSubdomain("https://evil-github.com/o/r", "github.com")).toBe(false);
    expect(isHostOrSubdomain("https://github.com.evil.io/o/r", "github.com")).toBe(false);
    expect(isHostOrSubdomain("https://evil.io/?u=github.com", "github.com")).toBe(false);
    expect(isHostOrSubdomain("https://evil.io/github.com", "github.com")).toBe(false);
    expect(isHostOrSubdomain("https://notmozilla.org/", "mozilla.org")).toBe(false);
  });

  it("rejects unparsable input", () => {
    expect(isHostOrSubdomain("http://[bad", "github.com")).toBe(false);
    expect(isHostOrSubdomain("", "github.com")).toBe(false);
  });
});

describe("isHostOrSubdomain without a scheme", () => {
  it("accepts bare and scp-style repository strings", () => {
    expect(isHostOrSubdomain("github.com/o/r", "github.com")).toBe(true);
    expect(isHostOrSubdomain("git@github.com:o/r.git", "github.com")).toBe(true);
    expect(isHostOrSubdomain("evil-github.com/o/r", "github.com")).toBe(false);
  });
});
