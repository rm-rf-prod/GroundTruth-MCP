import { describe, it, expect, afterEach, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

async function loadConfig(value?: string) {
  vi.resetModules();
  if (value !== undefined) vi.stubEnv("GT_NO_UPDATE_CHECK", value);
  return (await import("./config.js")).config;
}

describe("GT_NO_UPDATE_CHECK", () => {
  it("defaults to checking for updates", async () => {
    expect((await loadConfig()).noUpdateCheck).toBe(false);
  });

  it("opts out with GT_NO_UPDATE_CHECK=1", async () => {
    expect((await loadConfig("1")).noUpdateCheck).toBe(true);
  });

  it("treats any other value as not set", async () => {
    expect((await loadConfig("0")).noUpdateCheck).toBe(false);
  });
});
