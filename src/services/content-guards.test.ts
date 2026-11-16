import { describe, it, expect } from "vitest";
import { isGarbageContent } from "./content-guards.js";

const pad = "Some explanatory documentation text about the feature. ".repeat(10);
const doc = (line: string) => `# Guide\n\n${pad}\n\n${line}\n\n\`\`\`ts\nconst x = 1;\n\`\`\`\n\n${pad}\n${pad}\n${pad}`;

describe("isGarbageContent false positives", () => {
  it.each([
    "Pass the array id to the function.",
    "The API returns 429 when you exceed limits.",
    "If builds are slow, slow down the watcher.",
    "Show a fallback like Loading... while it suspends.",
  ])("keeps real docs: %s", (line) => {
    expect(isGarbageContent(doc(line)).garbage).toBe(false);
  });

  it("still rejects short challenge and rate-limit pages", () => {
    expect(isGarbageContent("Just a moment... Cloudflare Ray ID: 8a1b2c3d4e5f ".repeat(3)).garbage).toBe(true);
    expect(isGarbageContent("Error 429. Too many requests, please try again later. ".repeat(3)).garbage).toBe(true);
  });
});
