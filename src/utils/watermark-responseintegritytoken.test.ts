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
