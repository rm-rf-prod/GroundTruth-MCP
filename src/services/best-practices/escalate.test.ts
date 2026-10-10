import { describe, it, expect, vi } from "vitest";

vi.mock("../deep-fetch.js", () => ({ deepFetchForTopic: vi.fn(async (r: unknown) => r) }));

import { deepFetchForTopic } from "../deep-fetch.js";
import { escalateWeakEvidence } from "./escalate.js";

describe("escalateWeakEvidence", () => {
  it("deep-fetches with the URL patterns", async () => {
    await escalateWeakEvidence({
      text: "An unrelated page about rendering.",
      sourceUrl: "https://vuejs.org/guide",
      truncated: false,
      sourceType: "direct",
      topic: "composables",
      docsUrl: "https://vuejs.org/guide",
      tokens: 2000,
      urlPatterns: ["/guide/reusability/{slug}"],
    });
    expect(vi.mocked(deepFetchForTopic).mock.calls[0]?.[3]).toEqual(["/guide/reusability/{slug}"]);
  });
});
