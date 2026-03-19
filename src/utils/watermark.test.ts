import { describe, it, expect, vi } from "vitest";
import {
  getInstallId,
  embedWatermark,
  detectWatermark,
  responseIntegrityToken,
} from "./watermark.js";

const BIT0 = "\u2061"; // FUNCTION APPLICATION
const BIT1 = "\u2062"; // INVISIBLE TIMES

function countInvisible(text: string): number {
  return [...text].filter(c => c === BIT0 || c === BIT1).length;
}

function stripInvisible(text: string): string {
  return [...text].filter(c => c !== BIT0 && c !== BIT1).join("");
}

// ── getInstallId ───────────────────────────────────────────────────────────────

describe("getInstallId", () => {
  it("returns an 8-char lowercase hex string", () => {
    const id = getInstallId();
    expect(id).toMatch(/^[0-9a-f]{8}$/);
  });

  it("returns the same ID on repeated calls within a session", () => {
    const id1 = getInstallId();
    const id2 = getInstallId();
    expect(id1).toBe(id2);
  });

  it("returns exactly 8 characters", () => {
    expect(getInstallId().length).toBe(8);
  });

  it("still returns valid ID when writeFileSync throws (read-only fs catch path)", async () => {
    // vi.spyOn cannot intercept ESM node:fs namespace objects — use vi.doMock + fresh module import.
    vi.resetModules();
    vi.doMock("fs", () => ({
      existsSync: vi.fn(() => false),
      readFileSync: vi.fn(() => ""),
      writeFileSync: vi.fn(() => {
        throw new Error("EROFS: read-only file system");
      }),
    }));
    const { getInstallId: freshGetInstallId } = await import("./watermark.js");
    const id = freshGetInstallId();
    expect(id).toMatch(/^[0-9a-f]{8}$/);
    vi.doUnmock("fs");
  });
});

// ── embedWatermark ─────────────────────────────────────────────────────────────

describe("embedWatermark", () => {
  it("embeds exactly 64 invisible chars (32 for installId + 32 for nonce)", () => {
    const result = embedWatermark("hello\nworld");
    expect(countInvisible(result)).toBe(64);
  });

  it("only uses BIT0 (U+2061) and BIT1 (U+2062) as invisible chars", () => {
    const result = embedWatermark("line one\nline two");
    const invisibles = [...result].filter(c => c === BIT0 || c === BIT1);
    expect(invisibles.length).toBe(64);
    // All invisible chars are one of the two expected code points
    for (const c of invisibles) {
      expect([BIT0, BIT1]).toContain(c);
    }
  });

  it("preserves all visible content unchanged", () => {
    const original = "first line\nsecond line\nthird line";
    const result = embedWatermark(original);
    expect(stripInvisible(result)).toBe(original);
  });

  it("inserts watermark after first newline", () => {
    const result = embedWatermark("header\nbody");
    const parts = result.split("\n");
    // The 64 invisible chars are at the start of the second segment
    expect(countInvisible(parts[1] ?? "")).toBe(64);
    expect(countInvisible(parts[0] ?? "")).toBe(0);
  });

  it("appends watermark at end when text has no newline", () => {
    const result = embedWatermark("no newline here");
    expect(stripInvisible(result)).toBe("no newline here");
    expect(countInvisible(result)).toBe(64);
  });

  it("produces different output on consecutive calls (nonce differs)", () => {
    const r1 = embedWatermark("test\ntext");
    const r2 = embedWatermark("test\ntext");
    // Same visible content
    expect(stripInvisible(r1)).toBe(stripInvisible(r2));
    // Different invisible sequence (nonce is random)
    expect(r1).not.toBe(r2);
  });

  it("works with an empty string (no newline path)", () => {
    const result = embedWatermark("");
    expect(countInvisible(result)).toBe(64);
  });

  it("works with a string that is only a newline", () => {
    const result = embedWatermark("\n");
    expect(countInvisible(result)).toBe(64);
    expect(stripInvisible(result)).toBe("\n");
  });
});

// ── detectWatermark ────────────────────────────────────────────────────────────

describe("detectWatermark", () => {
  it("detects a watermark embedded by embedWatermark", () => {
    const watermarked = embedWatermark("IP notice\nresponse content");
    const result = detectWatermark(watermarked);
    expect(result.found).toBe(true);
    expect(result.installId).toMatch(/^[0-9a-f]{8}$/);
    expect(result.nonce).toMatch(/^[0-9a-f]{8}$/);
  });

  it("returns found:false for plain text with no invisible chars", () => {
    const result = detectWatermark("plain text with no watermark at all");
    expect(result.found).toBe(false);
    expect(result.installId).toBe("");
    expect(result.nonce).toBe("");
  });

  it("returns found:false when fewer than 64 invisible bits present", () => {
    const partial = BIT0.repeat(30) + BIT1.repeat(10); // 40 bits — not enough
    const result = detectWatermark("text " + partial);
    expect(result.found).toBe(false);
  });

  it("roundtrip: installId from detectWatermark matches getInstallId", () => {
    const id = getInstallId();
    const watermarked = embedWatermark("notice\ncontent");
    const result = detectWatermark(watermarked);
    expect(result.found).toBe(true);
    expect(result.installId).toBe(id);
  });

  it("nonces differ between two calls", () => {
    const w1 = embedWatermark("text\ncontent");
    const w2 = embedWatermark("text\ncontent");
    const r1 = detectWatermark(w1);
    const r2 = detectWatermark(w2);
    expect(r1.found).toBe(true);
    expect(r2.found).toBe(true);
    expect(r1.nonce).not.toBe(r2.nonce);
  });

  it("installId is consistent across multiple embeds in same session", () => {
    const w1 = embedWatermark("first\n");
    const w2 = embedWatermark("second\n");
    const r1 = detectWatermark(w1);
    const r2 = detectWatermark(w2);
    expect(r1.installId).toBe(r2.installId);
  });

  it("returns found:false for empty string", () => {
    const result = detectWatermark("");
    expect(result.found).toBe(false);
  });

  it("installId and nonce are each 8 hex chars", () => {
    const watermarked = embedWatermark("a\nb");
    const { installId, nonce } = detectWatermark(watermarked);
    expect(installId).toMatch(/^[0-9a-f]{8}$/);
    expect(nonce).toMatch(/^[0-9a-f]{8}$/);
  });
});

// ── responseIntegrityToken ─────────────────────────────────────────────────────

describe("responseIntegrityToken", () => {
  it("returns a 16-char lowercase hex string", () => {
    const token = responseIntegrityToken("some response text");
    expect(token).toMatch(/^[0-9a-f]{16}$/);
  });

  it("is deterministic for identical input", () => {
    const t1 = responseIntegrityToken("hello world");
    const t2 = responseIntegrityToken("hello world");
    expect(t1).toBe(t2);
  });

  it("differs for different input", () => {
    const t1 = responseIntegrityToken("hello world");
    const t2 = responseIntegrityToken("hello worlds");
    expect(t1).not.toBe(t2);
  });

  it("strips invisible watermark chars before hashing", () => {
    const plain = "hello world";
    const watermarked = embedWatermark("hello world");
    // Both should produce the same token (invisible chars are stripped)
    expect(responseIntegrityToken(plain)).toBe(responseIntegrityToken(watermarked));
  });

  it("produces 16-char output regardless of input length", () => {
    const cases = ["", "a", "a".repeat(10_000)];
    for (const input of cases) {
      expect(responseIntegrityToken(input).length).toBe(16);
    }
  });

  it("empty string produces a valid token", () => {
    const token = responseIntegrityToken("");
    expect(token).toMatch(/^[0-9a-f]{16}$/);
  });
});
