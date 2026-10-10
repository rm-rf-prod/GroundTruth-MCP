import { describe, it, expect, vi, afterEach } from "vitest";

const checkForUpdate = vi.hoisted(() => vi.fn(async () => null));

vi.mock("../utils/version-check.js", () => ({
  checkForUpdate,
  formatUpdateNotice: vi.fn(),
  setPendingUpdate: vi.fn(),
}));
vi.mock("./factory.js", () => ({ createServer: vi.fn(() => ({})) }));
vi.mock("@modelcontextprotocol/server/stdio", () => ({
  StdioServerTransport: vi.fn(function StdioServerTransportMock() { return {}; }),
  serveStdio: vi.fn(() => ({ close: vi.fn() })),
}));
vi.mock("../services/cache.js", () => ({ diskDocCache: { prune: vi.fn(async () => 0) } }));
vi.mock("../utils/watermark.js", () => ({ getInstallId: () => "test" }));

async function boot(noUpdateCheck: string | undefined): Promise<void> {
  vi.resetModules();
  checkForUpdate.mockClear();
  vi.stubEnv("GT_HTTP_PORT", undefined);
  vi.stubEnv("GT_NO_UPDATE_CHECK", noUpdateCheck);
  await import("./main.js");
  await new Promise((resolve) => setImmediate(resolve));
}

// main.ts installs process handlers on import; drop only the ones it added.
const events = ["SIGTERM", "SIGINT", "unhandledRejection"] as const;
const before = new Map(events.map((e) => [e, new Set(process.listeners(e))]));

afterEach(() => {
  vi.unstubAllEnvs();
  for (const e of events) {
    for (const l of process.listeners(e)) if (!before.get(e)?.has(l)) process.removeListener(e, l as never);
  }
});

describe("server startup update check", () => {
  it("checks the npm registry by default", async () => {
    await boot(undefined);
    expect(checkForUpdate).toHaveBeenCalledTimes(1);
  });

  it("skips the check entirely with GT_NO_UPDATE_CHECK=1", async () => {
    await boot("1");
    expect(checkForUpdate).not.toHaveBeenCalled();
  });
});
