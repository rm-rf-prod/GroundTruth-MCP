import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

async function loadConfig() {
  vi.resetModules();
  const mod = await import("./config.js");
  return mod.config;
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("config defaults", () => {
  it("has correct default tokenLimit", async () => {
    const cfg = await loadConfig();
    expect(cfg.tokenLimit).toBe(8000);
  });

  it("has correct default maxTokenLimit", async () => {
    const cfg = await loadConfig();
    expect(cfg.maxTokenLimit).toBe(20000);
  });

  it("has correct default cacheTtlMs (30 minutes)", async () => {
    const cfg = await loadConfig();
    expect(cfg.cacheTtlMs).toBe(30 * 60 * 1000);
  });

  it("has correct default fetchTimeoutMs", async () => {
    const cfg = await loadConfig();
    expect(cfg.fetchTimeoutMs).toBe(15_000);
  });

  it("has correct default deepFetchMaxPages", async () => {
    const cfg = await loadConfig();
    expect(cfg.deepFetchMaxPages).toBe(8);
  });

  it("has correct default deepFetchRelevanceThreshold", async () => {
    const cfg = await loadConfig();
    expect(cfg.deepFetchRelevanceThreshold).toBe(0.3);
  });

  it("has correct default deepFetchTimeoutMs", async () => {
    const cfg = await loadConfig();
    expect(cfg.deepFetchTimeoutMs).toBe(25_000);
  });

  it("has correct default maxConcurrentFetches", async () => {
    const cfg = await loadConfig();
    expect(cfg.maxConcurrentFetches).toBe(12);
  });

  it("has correct default toolTimeoutMs", async () => {
    const cfg = await loadConfig();
    expect(cfg.toolTimeoutMs).toBe(55_000);
  });

  it("has correct default swrStaleTtlMs (60 minutes)", async () => {
    const cfg = await loadConfig();
    expect(cfg.swrStaleTtlMs).toBe(60 * 60 * 1000);
  });

  it("has correct default circuitBreakerThreshold", async () => {
    const cfg = await loadConfig();
    expect(cfg.circuitBreakerThreshold).toBe(3);
  });

  it("has correct default circuitBreakerResetMs", async () => {
    const cfg = await loadConfig();
    expect(cfg.circuitBreakerResetMs).toBe(60_000);
  });

  it("has correct default logFormat", async () => {
    const cfg = await loadConfig();
    expect(cfg.logFormat).toBe("text");
  });

  it("has correct default logLevel", async () => {
    const cfg = await loadConfig();
    expect(cfg.logLevel).toBe("info");
  });

  it("has undefined httpPort by default", async () => {
    const cfg = await loadConfig();
    expect(cfg.httpPort).toBeUndefined();
  });
});

describe("env var overrides", () => {
  it("GT_TOKEN_LIMIT overrides tokenLimit", async () => {
    vi.stubEnv("GT_TOKEN_LIMIT", "5000");
    const cfg = await loadConfig();
    expect(cfg.tokenLimit).toBe(5000);
  });

  it("GT_MAX_TOKEN_LIMIT overrides maxTokenLimit", async () => {
    vi.stubEnv("GT_MAX_TOKEN_LIMIT", "10000");
    const cfg = await loadConfig();
    expect(cfg.maxTokenLimit).toBe(10000);
  });

  it("GT_CACHE_TTL_MS overrides cacheTtlMs", async () => {
    vi.stubEnv("GT_CACHE_TTL_MS", "60000");
    const cfg = await loadConfig();
    expect(cfg.cacheTtlMs).toBe(60000);
  });

  it("GT_FETCH_TIMEOUT_MS overrides fetchTimeoutMs", async () => {
    vi.stubEnv("GT_FETCH_TIMEOUT_MS", "30000");
    const cfg = await loadConfig();
    expect(cfg.fetchTimeoutMs).toBe(30000);
  });

  it("GT_DEEP_FETCH_MAX_PAGES overrides deepFetchMaxPages", async () => {
    vi.stubEnv("GT_DEEP_FETCH_MAX_PAGES", "4");
    const cfg = await loadConfig();
    expect(cfg.deepFetchMaxPages).toBe(4);
  });

  it("GT_LOG_FORMAT=json overrides logFormat", async () => {
    vi.stubEnv("GT_LOG_FORMAT", "json");
    const cfg = await loadConfig();
    expect(cfg.logFormat).toBe("json");
  });

  it("GT_LOG_LEVEL=debug overrides logLevel", async () => {
    vi.stubEnv("GT_LOG_LEVEL", "debug");
    const cfg = await loadConfig();
    expect(cfg.logLevel).toBe("debug");
  });

  it("GT_LOG_LEVEL=warn overrides logLevel", async () => {
    vi.stubEnv("GT_LOG_LEVEL", "warn");
    const cfg = await loadConfig();
    expect(cfg.logLevel).toBe("warn");
  });

  it("GT_LOG_LEVEL=error overrides logLevel", async () => {
    vi.stubEnv("GT_LOG_LEVEL", "error");
    const cfg = await loadConfig();
    expect(cfg.logLevel).toBe("error");
  });

  it("GT_HTTP_PORT overrides httpPort", async () => {
    vi.stubEnv("GT_HTTP_PORT", "8080");
    const cfg = await loadConfig();
    expect(cfg.httpPort).toBe("8080");
  });

  it("GT_CIRCUIT_BREAKER_THRESHOLD overrides circuitBreakerThreshold", async () => {
    vi.stubEnv("GT_CIRCUIT_BREAKER_THRESHOLD", "5");
    const cfg = await loadConfig();
    expect(cfg.circuitBreakerThreshold).toBe(5);
  });

  it("GT_MAX_CONCURRENT_FETCHES overrides maxConcurrentFetches", async () => {
    vi.stubEnv("GT_MAX_CONCURRENT_FETCHES", "6");
    const cfg = await loadConfig();
    expect(cfg.maxConcurrentFetches).toBe(6);
  });

  it("GT_TOKEN_LIMIT=0 is accepted (zero is valid)", async () => {
    vi.stubEnv("GT_TOKEN_LIMIT", "0");
    const cfg = await loadConfig();
    expect(cfg.tokenLimit).toBe(0);
  });
});

describe("invalid env vars throw", () => {
  it("throws on non-numeric GT_TOKEN_LIMIT", async () => {
    vi.stubEnv("GT_TOKEN_LIMIT", "abc");
    await expect(loadConfig()).rejects.toThrow('Invalid GT_TOKEN_LIMIT: "abc"');
  });

  it("throws on negative GT_TOKEN_LIMIT", async () => {
    vi.stubEnv("GT_TOKEN_LIMIT", "-1");
    await expect(loadConfig()).rejects.toThrow("Invalid GT_TOKEN_LIMIT");
  });

  it("throws on invalid GT_LOG_FORMAT", async () => {
    vi.stubEnv("GT_LOG_FORMAT", "xml");
    await expect(loadConfig()).rejects.toThrow('Invalid GT_LOG_FORMAT: "xml"');
  });

  it("throws on invalid GT_LOG_LEVEL", async () => {
    vi.stubEnv("GT_LOG_LEVEL", "verbose");
    await expect(loadConfig()).rejects.toThrow('Invalid GT_LOG_LEVEL: "verbose"');
  });

  it("throws on alphabetic GT_CACHE_TTL_MS", async () => {
    vi.stubEnv("GT_CACHE_TTL_MS", "abc");
    await expect(loadConfig()).rejects.toThrow("Invalid GT_CACHE_TTL_MS");
  });

  it("throws on empty string GT_FETCH_TIMEOUT_MS", async () => {
    vi.stubEnv("GT_FETCH_TIMEOUT_MS", "");
    await expect(loadConfig()).rejects.toThrow("Invalid GT_FETCH_TIMEOUT_MS");
  });
});

describe("config is frozen", () => {
  it("the config object is frozen", async () => {
    const cfg = await loadConfig();
    expect(Object.isFrozen(cfg)).toBe(true);
  });

  it("assigning a property throws in strict mode", async () => {
    const cfg = await loadConfig();
    expect(() => {
      "use strict";
      (cfg as Record<string, unknown>)["tokenLimit"] = 9999;
    }).toThrow();
  });
});
