import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const mockConfig = vi.hoisted(() => ({
  logFormat: "text" as "json" | "text",
  logLevel: "info" as "debug" | "info" | "warn" | "error",
}));

vi.mock("../config.js", () => ({
  config: mockConfig,
}));

import { log } from "./logger.js";

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  mockConfig.logFormat = "text";
  mockConfig.logLevel = "info";
});

describe("JSON format", () => {
  beforeEach(() => {
    mockConfig.logFormat = "json";
  });

  it("outputs valid JSON to console.error", () => {
    log({ level: "info", msg: "test message" });
    expect(console.error).toHaveBeenCalledOnce();
    const raw = (console.error as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it("includes ts, level, and msg fields", () => {
    log({ level: "info", msg: "hello world" });
    const raw = (console.error as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(parsed).toHaveProperty("ts");
    expect(parsed).toHaveProperty("level", "info");
    expect(parsed).toHaveProperty("msg", "hello world");
  });

  it("ts field is an ISO 8601 string", () => {
    log({ level: "info", msg: "timestamp check" });
    const raw = (console.error as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(typeof parsed["ts"]).toBe("string");
    expect(new Date(parsed["ts"] as string).toISOString()).toBe(parsed["ts"]);
  });

  it("includes extra field tool when provided", () => {
    log({ level: "info", msg: "with tool", tool: "resolve" });
    const raw = (console.error as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(parsed).toHaveProperty("tool", "resolve");
  });

  it("includes requestId when provided", () => {
    log({ level: "info", msg: "with req", requestId: "req-abc" });
    const raw = (console.error as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(parsed).toHaveProperty("requestId", "req-abc");
  });

  it("includes durationMs when provided", () => {
    log({ level: "info", msg: "timed", durationMs: 42 });
    const raw = (console.error as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(parsed).toHaveProperty("durationMs", 42);
  });

  it("includes cacheHit when provided", () => {
    log({ level: "info", msg: "cached", cacheHit: true });
    const raw = (console.error as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(parsed).toHaveProperty("cacheHit", true);
  });

  it("cacheHit=false appears in output", () => {
    log({ level: "info", msg: "miss", cacheHit: false });
    const raw = (console.error as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(parsed).toHaveProperty("cacheHit", false);
  });

  it("all extra fields appear together", () => {
    log({ level: "warn", msg: "full entry", tool: "docs", requestId: "r1", durationMs: 100, cacheHit: false });
    const raw = (console.error as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    expect(parsed["tool"]).toBe("docs");
    expect(parsed["requestId"]).toBe("r1");
    expect(parsed["durationMs"]).toBe(100);
    expect(parsed["cacheHit"]).toBe(false);
    expect(parsed["level"]).toBe("warn");
  });
});

describe("text format", () => {
  beforeEach(() => {
    mockConfig.logFormat = "text";
  });

  it("outputs readable text with level prefix", () => {
    log({ level: "info", msg: "hello text" });
    expect(console.error).toHaveBeenCalledWith("[info] hello text");
  });

  it("prefixes warn messages correctly", () => {
    log({ level: "warn", msg: "something off" });
    expect(console.error).toHaveBeenCalledWith("[warn] something off");
  });

  it("prefixes error messages correctly", () => {
    log({ level: "error", msg: "broke" });
    expect(console.error).toHaveBeenCalledWith("[error] broke");
  });

  it("appends tool= when tool provided", () => {
    log({ level: "info", msg: "doing work", tool: "search" });
    const output = (console.error as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    expect(output).toContain("tool=search");
  });

  it("appends req= when requestId provided", () => {
    log({ level: "info", msg: "request", requestId: "xyz-123" });
    const output = (console.error as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    expect(output).toContain("req=xyz-123");
  });

  it("appends duration in ms when durationMs provided", () => {
    log({ level: "info", msg: "timed", durationMs: 250 });
    const output = (console.error as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    expect(output).toContain("250ms");
  });

  it("appends cache=hit when cacheHit=true", () => {
    log({ level: "info", msg: "hit", cacheHit: true });
    const output = (console.error as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    expect(output).toContain("cache=hit");
  });

  it("appends cache=miss when cacheHit=false", () => {
    log({ level: "info", msg: "miss", cacheHit: false });
    const output = (console.error as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    expect(output).toContain("cache=miss");
  });

  it("all extra fields appear in correct order", () => {
    log({ level: "info", msg: "full", tool: "resolve", requestId: "r2", durationMs: 77, cacheHit: true });
    const output = (console.error as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    expect(output).toBe("[info] full tool=resolve req=r2 77ms cache=hit");
  });

  it("omits optional parts when not provided", () => {
    log({ level: "info", msg: "bare" });
    expect(console.error).toHaveBeenCalledWith("[info] bare");
  });
});

describe("log level filtering", () => {
  it("skips debug when logLevel=info", () => {
    mockConfig.logLevel = "info";
    log({ level: "debug", msg: "noisy debug" });
    expect(console.error).not.toHaveBeenCalled();
  });

  it("skips debug and info when logLevel=warn", () => {
    mockConfig.logLevel = "warn";
    log({ level: "debug", msg: "debug" });
    log({ level: "info", msg: "info" });
    expect(console.error).not.toHaveBeenCalled();
  });

  it("only logs error when logLevel=error", () => {
    mockConfig.logLevel = "error";
    log({ level: "debug", msg: "d" });
    log({ level: "info", msg: "i" });
    log({ level: "warn", msg: "w" });
    expect(console.error).not.toHaveBeenCalled();
    log({ level: "error", msg: "e" });
    expect(console.error).toHaveBeenCalledOnce();
  });

  it("logs debug when logLevel=debug", () => {
    mockConfig.logLevel = "debug";
    log({ level: "debug", msg: "verbose" });
    expect(console.error).toHaveBeenCalledOnce();
  });

  it("logs all levels when logLevel=debug", () => {
    mockConfig.logLevel = "debug";
    log({ level: "debug", msg: "d" });
    log({ level: "info", msg: "i" });
    log({ level: "warn", msg: "w" });
    log({ level: "error", msg: "e" });
    expect(console.error).toHaveBeenCalledTimes(4);
  });

  it("logs warn and error when logLevel=warn", () => {
    mockConfig.logLevel = "warn";
    log({ level: "warn", msg: "w" });
    log({ level: "error", msg: "e" });
    expect(console.error).toHaveBeenCalledTimes(2);
  });

  it("logs same level as configured", () => {
    mockConfig.logLevel = "info";
    log({ level: "info", msg: "at level" });
    expect(console.error).toHaveBeenCalledOnce();
  });
});
