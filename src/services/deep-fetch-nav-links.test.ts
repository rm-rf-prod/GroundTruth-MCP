import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockRace, mockTryFetch } = vi.hoisted(() => ({
  mockRace: vi.fn<(url: string) => Promise<string | null>>(),
  mockTryFetch: vi.fn<(url: string) => Promise<string | null>>(),
}));

vi.mock("./fetcher.js", () => ({
  fetchAsMarkdownRace: mockRace,
  isIndexContent: () => false,
  rankIndexLinks: () => [],
  fetchSitemapUrls: async () => [],
}));
vi.mock("./http/try-fetch.js", () => ({ tryFetch: mockTryFetch }));
vi.mock("../utils/logger.js", () => ({ log: vi.fn() }));

import { deepFetchForTopic } from "./deep-fetch.js";
import { pageNavLinks } from "./deep-fetch-pages.js";

const PAGE = "Theme variables are special CSS variables defined with the @theme directive. ".repeat(10);

// Shaped like tailwindcss.com and docs.spring.io: the sidebar is the only place sibling pages are linked.
const SIDEBAR = `<!DOCTYPE html><html><body><nav>
  <a href="/docs/installation">Installation</a>
  <a class="nav-link" href="/docs/theme"><span>Theme</span> variables</a>
  <a href="endpoints.html#top">Endpoints</a>
  <a href="https://other.example.com/docs/theme">Elsewhere</a>
  <a href="#main">Skip</a>
  <a href="javascript:alert(1)">Bad</a>
  <a href="/docs/installation">Installation again</a>
</nav><main><p>Install it.</p></main><a href="/unclosed">never closed</body></html>`;

beforeEach(() => {
  mockRace.mockReset().mockResolvedValue(null);
  mockTryFetch.mockReset().mockResolvedValue(null);
});

describe("pageNavLinks", () => {
  it("returns same-origin links with relative hrefs resolved, without the page itself or duplicates", async () => {
    mockTryFetch.mockResolvedValue(SIDEBAR);
    const links = await pageNavLinks("https://docs.example.com/docs/guide.html");
    expect(links).toEqual([
      { url: "https://docs.example.com/docs/installation", text: "Installation" },
      { url: "https://docs.example.com/docs/theme", text: "Theme variables" },
      { url: "https://docs.example.com/docs/endpoints.html", text: "Endpoints" },
    ]);
  });

  it("reads nothing from a page that is not HTML", async () => {
    mockTryFetch.mockResolvedValue("# Title\n\n[Theme](/docs/theme)\n".repeat(20));
    expect(await pageNavLinks("https://docs.example.com/llms.txt")).toEqual([]);
  });
});

describe("deepFetchForTopic sidebar links", () => {
  it("follows a sidebar link the converted page no longer has (tailwind theme variables)", async () => {
    mockTryFetch.mockResolvedValue(SIDEBAR);
    mockRace.mockImplementation(async (url) => (url === "https://tailwindcss.com/docs/theme" ? PAGE : null));
    const initial = { content: "Get started. Install Tailwind CSS with Vite.", url: "https://tailwindcss.com/docs", sourceType: "direct" as const };
    const result = await deepFetchForTopic(initial, "theme variables", "https://tailwindcss.com/docs");
    expect(result.url).toBe("https://tailwindcss.com/docs/theme");
    expect(result.content).toContain("@theme directive");
  });

  it("does not refetch an llms file for sidebar links", async () => {
    const initial = { content: "unrelated", url: "https://d.example.com/llms.txt", sourceType: "llms-txt" as const };
    await deepFetchForTopic(initial, "theme variables", "https://d.example.com/docs");
    expect(mockTryFetch).not.toHaveBeenCalled();
  });
});
