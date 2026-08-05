import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import {
  isExtractionAttempt,
  withNotice,
  EXTRACTION_REFUSAL,
  IP_NOTICE,
  safeguardPath,
  assertPublicUrl,
  withToolTimeout,
  generateRequestId,
} from "./guard.js";

// ── safeguardPath ──────────────────────────────────────────────────────────────

describe("safeguardPath", () => {
  it("returns the resolved path for a normal project directory", () => {
    const result = safeguardPath("/home/user/projects/myapp");
    expect(result).toBe("/home/user/projects/myapp");
  });

  it("resolves relative paths to absolute", () => {
    const result = safeguardPath(".");
    expect(result).toBe(process.cwd());
  });

  it.each([
    "/etc",
    "/etc/passwd",
    "/etc/shadow",
    "/proc",
    "/proc/self/environ",
    "/sys",
    "/sys/kernel",
    "/dev",
    "/dev/null",
    "/boot",
    "/root",
    "/var/run",
    "/run",
    "/run/secrets",
  ])("blocks system path: %s", (path) => {
    expect(() => safeguardPath(path)).toThrow("Access to system path denied");
  });

  it("does not block /home directories", () => {
    expect(() => safeguardPath("/home/user/projects")).not.toThrow();
  });

  it("does not block /tmp", () => {
    expect(() => safeguardPath("/tmp/myproject")).not.toThrow();
  });

  it("does not block /var/www (only /var/run is blocked)", () => {
    expect(() => safeguardPath("/var/www/html")).not.toThrow();
  });

  // SEC-007: symlink following (CWE-61)
  it("blocks symlink pointing into /etc via an allowed directory", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "gt-guard-test-"));
    const symlinkPath = path.join(tmpDir, "evil");
    fs.symlinkSync("/etc", symlinkPath);
    try {
      expect(() => safeguardPath(symlinkPath)).toThrow("Access to system path denied");
    } finally {
      fs.unlinkSync(symlinkPath);
      fs.rmdirSync(tmpDir);
    }
  });

  // SEC-007: ENOENT fallback — non-existent path must not throw
  it("does not throw for a non-existent path (ENOENT fallback)", () => {
    expect(() => safeguardPath("/home/user/nonexistent-project-xyz")).not.toThrow();
  });
});

// ── assertPublicUrl ────────────────────────────────────────────────────────────

describe("assertPublicUrl", () => {
  describe("allows public HTTPS/HTTP URLs", () => {
    it.each([
      "https://docs.stripe.com",
      "https://react.dev/docs",
      "http://example.com/page",
      "https://nextjs.org/docs/app",
      "https://raw.githubusercontent.com/owner/repo/main/README.md",
    ])("allows: %s", (url) => {
      expect(() => assertPublicUrl(url)).not.toThrow();
    });
  });

  describe("blocks private/internal addresses", () => {
    it.each([
      ["localhost", "http://localhost/api"],
      ["127.0.0.1", "http://127.0.0.1/secret"],
      ["127.0.0.2", "http://127.0.0.2/secret"],
      ["10.0.0.1 (RFC-1918)", "http://10.0.0.1/internal"],
      ["10.255.255.255 (RFC-1918)", "http://10.255.255.255/"],
      ["172.16.0.1 (RFC-1918)", "http://172.16.0.1/"],
      ["172.31.255.255 (RFC-1918)", "http://172.31.255.255/"],
      ["192.168.1.1 (RFC-1918)", "http://192.168.1.1/router"],
      ["169.254.169.254 (AWS metadata)", "http://169.254.169.254/latest/meta-data/"],
      ["0.0.0.0", "http://0.0.0.0/"],
      ["::1 (IPv6 loopback)", "http://[::1]/"],
      [".local (mDNS)", "http://myservice.local/"],
    ])("blocks %s", (_label, url) => {
      expect(() => assertPublicUrl(url)).toThrow();
    });
  });

  it("throws for non-http/https protocols", () => {
    expect(() => assertPublicUrl("file:///etc/passwd")).toThrow("Unsupported URL protocol");
    expect(() => assertPublicUrl("ftp://example.com")).toThrow("Unsupported URL protocol");
  });

  it("throws for malformed URLs", () => {
    expect(() => assertPublicUrl("not-a-url")).toThrow("Invalid URL");
    expect(() => assertPublicUrl("")).toThrow();
  });
});

// ── isExtractionAttempt ────────────────────────────────────────────────────────
