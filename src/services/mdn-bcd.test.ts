import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("./fetcher.js", () => ({
  fetchWithTimeout: vi.fn(),
}));

import { fetchMdnDocMeta, renderBcdTable, formatBaseline } from "./mdn-bcd.js";
import { fetchWithTimeout } from "./fetcher.js";

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as unknown as Response;
}

beforeEach(() => {
  vi.mocked(fetchWithTimeout).mockReset();
});

describe("fetchMdnDocMeta", () => {
  it("returns null for non-MDN hosts (never fetches)", async () => {
    const meta = await fetchMdnDocMeta("https://evil.example.com/docs/Web/API/fetch");
    expect(meta).toBeNull();
    expect(fetchWithTimeout).not.toHaveBeenCalled();
  });

  it("parses summary, browserCompat paths, and baseline from index.json", async () => {
    vi.mocked(fetchWithTimeout).mockResolvedValue(
      jsonResponse({
        doc: {
          pageTitle: "Array.prototype.at() - JavaScript | MDN",
          summary: "The at() method takes an integer value.",
          browserCompat: ["javascript.builtins.Array.at"],
          baseline: {
            baseline: "high",
            baseline_low_date: "2022-03-14",
            baseline_high_date: "2024-09-14",
          },
        },
      }),
    );
    const meta = await fetchMdnDocMeta(
      "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/at",
    );
    expect(meta).not.toBeNull();
    expect(meta?.browserCompat).toEqual(["javascript.builtins.Array.at"]);
    expect(meta?.baseline?.level).toBe("high");
    expect(meta?.baseline?.highDate).toBe("2024-09-14");
    const calledUrl = vi.mocked(fetchWithTimeout).mock.calls[0]?.[0] as string;
    expect(calledUrl).toBe(
      "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Array/at/index.json",
    );
  });

  it("returns null (not a throw) on HTTP errors", async () => {
    vi.mocked(fetchWithTimeout).mockResolvedValue(jsonResponse({}, false, 404));
    const meta = await fetchMdnDocMeta("https://developer.mozilla.org/en-US/docs/Web/Nope");
    expect(meta).toBeNull();
  });

  it("treats a doc without baseline as limited=null and empty compat list", async () => {
    vi.mocked(fetchWithTimeout).mockResolvedValue(
      jsonResponse({ doc: { pageTitle: "Guide page", summary: "A guide." } }),
    );
    const meta = await fetchMdnDocMeta("https://developer.mozilla.org/en-US/docs/Web/Guide");
    expect(meta?.browserCompat).toEqual([]);
    expect(meta?.baseline).toBeNull();
  });
});

describe("renderBcdTable", () => {
  const BCD_BODY = {
    data: {
      __compat: {
        support: {
          chrome: { version_added: "92" },
          firefox: [{ version_added: "90" }, { version_added: "85", flags: [{}] }],
          safari: { version_added: "15.4" },
          ie: { version_added: false },
          nodejs: { version_added: "16.6.0" },
          deno: { version_added: "1.12" },
          bun: { version_added: "1.0.0" },
        },
        status: { deprecated: false, experimental: false, standard_track: true },
      },
    },
  };

  it("renders a markdown table with exact version_added values incl. runtimes", async () => {
    vi.mocked(fetchWithTimeout).mockResolvedValue(jsonResponse(BCD_BODY));
    const table = await renderBcdTable("javascript.builtins.Array.at");
    expect(table).toContain("| Chrome | 92 |");
    expect(table).toContain("| Firefox | 90 |");
    expect(table).toContain("| Node.js | 16.6.0 |");
    expect(table).toContain("| Deno | 1.12 |");
    expect(table).toContain("| Bun | 1.0.0 |");
    // Non-flagged statement preferred over the flag-gated one
    expect(table).not.toContain("| Firefox | 85");
  });

  it("filters rows by environments and falls back to all when nothing matches", async () => {
    vi.mocked(fetchWithTimeout).mockResolvedValue(jsonResponse(BCD_BODY));
    const nodeOnly = await renderBcdTable("javascript.builtins.Array.at", ["node"]);
    expect(nodeOnly).toContain("Node.js");
    expect(nodeOnly).not.toContain("| Chrome |");

    vi.mocked(fetchWithTimeout).mockResolvedValue(jsonResponse(BCD_BODY));
    const unknownEnv = await renderBcdTable("javascript.builtins.Array.at", ["quantumbrowser"]);
    expect(unknownEnv).toContain("| Chrome | 92 |");
  });

  it("flags deprecated features in the heading", async () => {
    vi.mocked(fetchWithTimeout).mockResolvedValue(
      jsonResponse({
        data: {
          __compat: {
            support: { chrome: { version_added: "10" } },
            status: { deprecated: true, standard_track: true },
          },
        },
      }),
    );
    const table = await renderBcdTable("api.Document.oldThing");
    expect(table).toContain("DEPRECATED");
  });

  it("rejects invalid BCD paths without fetching", async () => {
    const table = await renderBcdTable("javascript/../../etc/passwd");
    expect(table).toBeNull();
    expect(fetchWithTimeout).not.toHaveBeenCalled();
  });

  it("returns null when no __compat node exists", async () => {
    vi.mocked(fetchWithTimeout).mockResolvedValue(jsonResponse({ data: { nothing: {} } }));
    expect(await renderBcdTable("css.properties.unknown")).toBeNull();
  });

  it("returns null (not a throw) when the underlying fetch rejects", async () => {
    vi.mocked(fetchWithTimeout).mockRejectedValue(new Error("network down"));
    await expect(renderBcdTable("javascript.builtins.Array.at")).resolves.toBeNull();
  });

  it("returns null (not a throw) on a non-ok HTTP response (500)", async () => {
    vi.mocked(fetchWithTimeout).mockResolvedValue(jsonResponse({}, false, 500));
    await expect(renderBcdTable("javascript.builtins.Array.at")).resolves.toBeNull();
  });
});

describe("formatBaseline", () => {
  it("describes all three levels", () => {
    expect(formatBaseline({ level: "high", highDate: "2024-09-14" })).toContain("Widely available since 2024-09-14");
    expect(formatBaseline({ level: "low", lowDate: "2025-01-01" })).toContain("Newly available since 2025-01-01");
    expect(formatBaseline({ level: "limited" })).toContain("Limited availability");
    expect(formatBaseline(null)).toBe("");
  });
});
