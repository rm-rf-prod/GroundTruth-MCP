import { describe, it, expect, vi, afterEach } from "vitest";
import { LRUCache } from "./lru-cache.js";
import { SWR_STALE_TTL_MS } from "../constants.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("LRUCache overwrite (MEM-07)", () => {
  it("overwriting a key at capacity keeps every other entry", () => {
    const cache = new LRUCache<string>(2);
    cache.set("a", "1");
    cache.set("b", "2");
    cache.set("b", "3");
    expect(cache.get("a")).toBe("1");
    expect(cache.get("b")).toBe("3");
  });

  it("an overwritten key becomes most recently used", () => {
    const cache = new LRUCache<string>(2);
    cache.set("a", "1");
    cache.set("b", "2");
    cache.set("a", "3");
    cache.set("c", "4");
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBe("3");
  });
});

describe("LRUCache character budget (MEM-07)", () => {
  it("evicts the oldest entries until the new value fits", () => {
    const cache = new LRUCache<string>(10, 10);
    cache.set("a", "xxxx");
    cache.set("b", "xxxx");
    cache.set("c", "xxxx");
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe("xxxx");
    expect(cache.get("c")).toBe("xxxx");
  });

  it("does not cache a single value larger than the budget", () => {
    const cache = new LRUCache<string>(10, 10);
    cache.set("a", "xx");
    cache.set("big", "x".repeat(11));
    expect(cache.get("big")).toBeUndefined();
    expect(cache.get("a")).toBe("xx");
  });

  it("frees the budget on overwrite, expiry and clear", () => {
    vi.useFakeTimers();
    const cache = new LRUCache<string>(10, 10);
    cache.set("a", "x".repeat(10));
    cache.set("a", "x".repeat(10));
    expect(cache.get("a")).toBe("x".repeat(10));
    cache.set("gone", "x".repeat(10), 1);
    vi.advanceTimersByTime(SWR_STALE_TTL_MS + 10);
    expect(cache.get("gone")).toBeUndefined();
    cache.set("b", "x".repeat(10));
    expect(cache.get("b")).toBe("x".repeat(10));
    cache.clear();
    cache.set("c", "x".repeat(10));
    expect(cache.get("c")).toBe("x".repeat(10));
  });

  it("docCache is bounded by characters, not only by entry count", async () => {
    const { docCache } = await import("./cache.js");
    docCache.set("mem07-huge", "x".repeat(32_000_001));
    expect(docCache.get("mem07-huge")).toBeUndefined();
  });
});

describe("LRUCache revalidating read (NET-05)", () => {
  it("serves past the SWR window up to maxStaleMs and reports the expiry", () => {
    vi.useFakeTimers();
    const cache = new LRUCache<string>(10);
    cache.set("k", "v", 1000);
    const expiresAt = Date.now() + 1000;
    vi.advanceTimersByTime(1000 + SWR_STALE_TTL_MS + 1);
    const onHit = vi.fn();
    expect(cache.get("k", { maxStaleMs: 2 * SWR_STALE_TTL_MS, onHit })).toBe("v");
    expect(onHit).toHaveBeenCalledWith(expiresAt);
    vi.advanceTimersByTime(SWR_STALE_TTL_MS);
    expect(cache.get("k", { maxStaleMs: 2 * SWR_STALE_TTL_MS, onHit })).toBeUndefined();
  });

  it("a plain get() still drops entries past the SWR window", () => {
    vi.useFakeTimers();
    const cache = new LRUCache<string>(10);
    cache.set("k", "v", 1000);
    vi.advanceTimersByTime(1000 + SWR_STALE_TTL_MS + 1);
    expect(cache.get("k")).toBeUndefined();
  });
});
