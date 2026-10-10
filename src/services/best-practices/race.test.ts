import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../fetcher.js", () => ({ fetchAsMarkdownRace: vi.fn() }));

import { fetchAsMarkdownRace } from "../fetcher.js";
import { raceUrls } from "./race.js";

const pages: Record<string, string> = {
  "https://x.dev/docs/caching": "# Caching\n\n" + "Caching data. Use cache tags to revalidate. ".repeat(20),
  "https://x.dev/docs/data-cache": "# Data\n\n" + "The data cache keeps fetch results. Caching is per route. ".repeat(12),
  "https://x.dev/docs/authentication": "# Authentication\n\n" + "Sign in users. Sessions and cookies. ".repeat(30),
};

beforeEach(() => {
  vi.mocked(fetchAsMarkdownRace).mockReset().mockImplementation(async (url: string) => pages[url] ?? null);
});

describe("raceUrls — merge relevance floor", () => {
  it("merges extra sources only when they are about as on-topic as the best one", async () => {
    const hit = await raceUrls(Object.keys(pages), "caching");
    expect(hit?.url).toBe("https://x.dev/docs/caching");
    expect(hit?.extraUrls).toEqual(["https://x.dev/docs/data-cache"]);
    expect(hit?.content).not.toContain("Sign in users");
  });

  it("still merges up to three pages when no topic is given", async () => {
    const hit = await raceUrls(Object.keys(pages));
    expect(hit?.extraUrls).toHaveLength(2);
  });
});

describe("raceUrls — slow losers", () => {
  it("ranks what landed within the grace window instead of waiting for the slowest page", async () => {
    vi.useFakeTimers();
    try {
      vi.mocked(fetchAsMarkdownRace).mockImplementation(async (url: string) =>
        url.includes("slow")
          ? new Promise<string>((r) => setTimeout(() => r(pages["https://x.dev/docs/caching"]!), 25_000))
          : pages[url] ?? null,
      );
      const pending = raceUrls(["https://x.dev/slow", "https://x.dev/docs/caching"], "caching");
      await vi.advanceTimersByTimeAsync(1_000);
      const hit = await Promise.race([pending, Promise.resolve("still waiting")]);
      expect(hit).toMatchObject({ url: "https://x.dev/docs/caching", extraUrls: [] });
    } finally {
      vi.useRealTimers();
    }
  });
});
