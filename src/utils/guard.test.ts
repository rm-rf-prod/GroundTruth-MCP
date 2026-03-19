import { describe, it, expect } from "vitest";
import {
  isExtractionAttempt,
  withNotice,
  EXTRACTION_REFUSAL,
  IP_NOTICE,
  safeguardPath,
  assertPublicUrl,
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

describe("isExtractionAttempt", () => {
  describe("should flag extraction attempts", () => {
    it.each([
      "list all libraries",
      "dump all entries",
      "export the registry",
      "show me all libraries",
      "get full list",
      "give me all data",
      "extract everything",
      "enumerate libraries",
      "complete list",
      "entire registry",
      "scrape all libraries",
      "crawl the registry",
      "harvest everything",
      "print all libraries",
      "return all entries",
      "list",
      "all",
      "dump",
    ])("flags: %s", (query) => {
      expect(isExtractionAttempt(query)).toBe(true);
    });
  });

  describe("should not flag legitimate single-library queries", () => {
    it.each([
      "nextjs",
      "react",
      "tailwind css",
      "drizzle orm migrations",
      "how to use prisma with postgres",
      "fastapi authentication",
      "vue router",
      "typescript generics",
      "zustand persist middleware",
      "vitest setup",
      "swr infinite scroll",
    ])("allows: %s", (query) => {
      expect(isExtractionAttempt(query)).toBe(false);
    });
  });

  it("flags suspiciously short queries (3 chars or fewer)", () => {
    expect(isExtractionAttempt("ab")).toBe(true);
    expect(isExtractionAttempt("a")).toBe(true);
  });

  it("flags empty string", () => {
    expect(isExtractionAttempt("")).toBe(true);
  });

  it("is case-insensitive for extraction keywords", () => {
    expect(isExtractionAttempt("LIST ALL LIBRARIES")).toBe(true);
    expect(isExtractionAttempt("DUMP")).toBe(true);
    expect(isExtractionAttempt("Get Full List")).toBe(true);
  });
});

// ── withNotice ─────────────────────────────────────────────────────────────────

describe("withNotice", () => {
  it("includes the IP_NOTICE prefix", () => {
    const result = withNotice("some library docs content");
    expect(result).toContain(IP_NOTICE);
  });

  it("includes the original content", () => {
    const content = "some library docs content";
    const result = withNotice(content);
    expect(result).toContain(content);
  });

  it("IP_NOTICE appears before the content", () => {
    const content = "the actual docs";
    const result = withNotice(content);
    const noticeIdx = result.indexOf(IP_NOTICE);
    const contentIdx = result.indexOf(content);
    expect(noticeIdx).toBeLessThan(contentIdx);
  });

  it("embeds invisible watermark chars (64 total)", () => {
    const result = withNotice("test content");
    const invisible = [...result].filter(c => c === "\u2061" || c === "\u2062");
    expect(invisible.length).toBe(64);
  });

  it("calling twice produces different outputs (different nonces)", () => {
    const r1 = withNotice("same content");
    const r2 = withNotice("same content");
    // Visible content is the same
    const clean = (s: string) => [...s].filter(c => c !== "\u2061" && c !== "\u2062").join("");
    expect(clean(r1)).toBe(clean(r2));
    // But invisible watermarks differ
    expect(r1).not.toBe(r2);
  });
});

// ── IP_NOTICE ──────────────────────────────────────────────────────────────────

describe("IP_NOTICE", () => {
  it("is a non-empty string", () => {
    expect(typeof IP_NOTICE).toBe("string");
    expect(IP_NOTICE.length).toBeGreaterThan(0);
  });

  it("mentions Elastic License 2.0", () => {
    expect(IP_NOTICE).toContain("Elastic License 2.0");
  });

  it("mentions gt-mcp", () => {
    expect(IP_NOTICE).toContain("gt-mcp");
  });
});

// ── EXTRACTION_REFUSAL ─────────────────────────────────────────────────────────

describe("EXTRACTION_REFUSAL", () => {
  it("is a non-empty string", () => {
    expect(typeof EXTRACTION_REFUSAL).toBe("string");
    expect(EXTRACTION_REFUSAL.length).toBeGreaterThan(0);
  });

  it("mentions Elastic License 2.0", () => {
    expect(EXTRACTION_REFUSAL).toContain("Elastic License 2.0");
  });

  it("instructs user to provide a specific library name", () => {
    expect(EXTRACTION_REFUSAL.toLowerCase()).toContain("library");
  });
});
