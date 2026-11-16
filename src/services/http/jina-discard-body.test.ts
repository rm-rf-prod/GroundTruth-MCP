import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../cache.js", () => ({
  docCache: { get: () => undefined, set: () => undefined },
  diskDocCache: { get: vi.fn(async () => undefined), set: vi.fn(async () => undefined) },
}));
const cancel = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("./request.js", async (orig) => ({
  ...(await orig<typeof import("./request.js")>()),
  fetchWithTimeout: vi.fn(async () => ({ ok: false, status: 500, headers: new Headers(), body: { cancel } }) as unknown as Response),
}));

import { fetchViaJina } from "./jina.js";
import { resetAllCircuits } from "../circuit-breaker.js";

beforeEach(() => { cancel.mockClear(); resetAllCircuits(); });
afterEach(() => vi.clearAllMocks());

describe("fetchViaJina error bodies", () => {
  it("discards the unread body of a non-ok response", async () => {
    expect(await fetchViaJina("https://example.com/err")).toBeNull();
    expect(cancel).toHaveBeenCalled();
  });
});
