import { describe, it, expect, vi } from "vitest";

// Every name resolves to the cloud metadata address, as in a DNS-rebinding attack.
vi.mock("dns", () => ({
  default: {
    lookup: (_host: string, _opts: unknown, cb: (err: null, addrs: Array<{ address: string; family: number }>) => void) =>
      cb(null, [{ address: "169.254.169.254", family: 4 }]),
  },
}));

describe("SSRF dispatcher", () => {
  it("refuses to connect when a hostname resolves to a blocked address", async () => {
    await import("./dispatcher.js");
    const err = await fetch("http://rebind.example.com/").catch((e: unknown) => e);
    expect(err).toBeInstanceOf(Error);
    expect(String((err as Error & { cause?: unknown }).cause)).toContain("SSRF blocked");
  });
});
