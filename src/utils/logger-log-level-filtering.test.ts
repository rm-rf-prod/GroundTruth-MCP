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
