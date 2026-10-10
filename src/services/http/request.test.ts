import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const dispatcher = vi.hoisted(() => ({ loaded: false }));
vi.mock("./dispatcher.js", () => {
  dispatcher.loaded = true;
  return {};
});

import { fetchWithTimeout } from "./request.js";
import { singleFlight } from "./single-flight.js";
import { runWithCallSignal } from "../../utils/guard.js";

const mockFetch = vi.fn<typeof fetch>();
const headersOf = (call: number) => mockFetch.mock.calls[call]?.[1]?.headers as Record<string, string>;
const redirect = (location: string) => new Response(null, { status: 302, headers: { location } });

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
  mockFetch.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchWithTimeout", () => {
  it("installs the SSRF dispatcher on first use, before the first request (PERF-STARTUP-10)", async () => {
    expect(dispatcher.loaded).toBe(false);
    mockFetch.mockImplementation(async () => {
      expect(dispatcher.loaded).toBe(true);
      return new Response("ok");
    });
    const out = await fetchWithTimeout("https://example.com/a", 5000);
    expect(await out.text()).toBe("ok");
  });

  it("drops Authorization when a redirect leaves the origin (ENT-10)", async () => {
    mockFetch
      .mockResolvedValueOnce(redirect("https://objects.attacker.example/collect"))
      .mockResolvedValueOnce(new Response("ok"));
    await fetchWithTimeout("https://raw.githubusercontent.com/a/b/HEAD/README.md", 5000, { Authorization: "Bearer ghp_SECRET" });
    expect(headersOf(0).Authorization).toBe("Bearer ghp_SECRET");
    expect(headersOf(1).Authorization).toBeUndefined();
    expect(mockFetch.mock.calls[1]?.[0]).toBe("https://objects.attacker.example/collect");
  });

  it("keeps Authorization on a same-origin redirect (ENT-10)", async () => {
    mockFetch
      .mockResolvedValueOnce(redirect("/repos/renamed/readme"))
      .mockResolvedValueOnce(new Response("ok"));
    await fetchWithTimeout("https://api.github.com/repos/old/readme", 5000, { Authorization: "Bearer ghp_SECRET" });
    expect(headersOf(1).Authorization).toBe("Bearer ghp_SECRET");
  });

  it("echoes one same-URL challenge cookie, and only to that origin", async () => {
    const challenge = new Response(null, {
      status: 302,
      headers: [["location", "/docs"], ["set-cookie", "milvus_challenge=abc; Path=/; HttpOnly"]],
    });
    mockFetch.mockResolvedValueOnce(challenge).mockResolvedValueOnce(redirect("https://other.example/x")).mockResolvedValueOnce(new Response("ok"));
    await fetchWithTimeout("https://milvus.example/docs", 5000);
    expect(headersOf(0).Cookie).toBeUndefined();
    expect(headersOf(1).Cookie).toBe("milvus_challenge=abc");
    expect(headersOf(2).Cookie).toBeUndefined();
  });

  it("does not echo a cookie set on a redirect to a different URL", async () => {
    mockFetch
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: [["location", "/b"], ["set-cookie", "t=1"]] }))
      .mockResolvedValueOnce(new Response("ok"));
    await fetchWithTimeout("https://site.example/a", 5000);
    expect(headersOf(1).Cookie).toBeUndefined();
  });

  it("cancels the body of a redirect hop it does not read", async () => {
    const cancel = vi.fn(async () => {});
    const hop = { status: 302, headers: new Headers({ location: "/b" }), body: { cancel } } as unknown as Response;
    mockFetch.mockResolvedValueOnce(hop).mockResolvedValueOnce(new Response("ok"));
    await fetchWithTimeout("https://site.example/a", 5000);
    expect(cancel).toHaveBeenCalled();
  });
});

describe("fetchWithTimeout cancellation", () => {
  const settle: Array<(res: Response) => void> = [];
  const hang = () => mockFetch.mockImplementation((_u, init) => new Promise((resolve, reject) => {
    settle.push(resolve);
    init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
  }));

  it("aborts the request when the tool call's signal aborts", async () => {
    hang();
    const call = new AbortController();
    const pending = runWithCallSignal(call.signal, () => fetchWithTimeout("https://slow.example/a", 60_000));
    await vi.waitFor(() => expect(mockFetch).toHaveBeenCalled());
    call.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
  });

  it("keeps a single-flight fetch running when the caller that started it aborts", async () => {
    hang();
    const call = new AbortController();
    const shared = runWithCallSignal(call.signal, () =>
      singleFlight(new Map<string, Promise<Response>>(), "k", () => fetchWithTimeout("https://slow.example/b", 60_000)));
    await vi.waitFor(() => expect(mockFetch).toHaveBeenCalled());
    call.abort();
    settle.at(-1)?.(new Response("late but whole"));
    expect(await (await shared).text()).toBe("late but whole");
  });
});
