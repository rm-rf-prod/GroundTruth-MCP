import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the network layer; sanitizeContent + extractSnippets run for real so the
// test exercises the genuine empty-index detection and fallback wiring.
vi.mock("../services/fetcher.js", () => ({
  fetchDocs: vi.fn(),
  fetchGitHubContent: vi.fn(),
  fetchAsMarkdownRace: vi.fn(),
}));

import { buildIndex } from "./snippets.js";
import { fetchDocs, fetchGitHubContent, fetchAsMarkdownRace } from "../services/fetcher.js";

const DOCS_WITH_CODE = [
  "# Express",
  "",
  "Middleware example:",
  "",
  "```js",
  "const app = express();",
  "app.use(logger);",
  "app.listen(3000);",
  "```",
  "",
].join("\n");

const PROSE_NO_CODE =
  "# Express\n\nExpress is a fast, unopinionated, minimalist web framework for Node.js. " +
  "It provides a thin layer of fundamental web application features without obscuring Node.js.";

const README_WITH_CODE = [
  "# express",
  "",
  "Fast, unopinionated, minimalist web framework.",
  "",
  "```js",
  "const express = require('express');",
  "const app = express();",
  "app.get('/', (req, res) => res.send('ok'));",
  "```",
  "",
].join("\n");

beforeEach(() => {
  vi.mocked(fetchDocs).mockReset();
  vi.mocked(fetchGitHubContent).mockReset().mockResolvedValue(null);
  vi.mocked(fetchAsMarkdownRace).mockReset().mockResolvedValue(null);
});

describe("buildIndex (gt_snippets) — FIX-9 GitHub README fallback", () => {
  it("indexes snippets from docs and does NOT hit GitHub when docs have code", async () => {
    vi.mocked(fetchDocs).mockResolvedValue({
      content: DOCS_WITH_CODE,
      url: "https://expressjs.com/",
      sourceType: "llms-txt",
    });
    const index = await buildIndex(
      "expressjs/express",
      undefined,
      "https://expressjs.com/",
      undefined,
      undefined,
      "https://github.com/expressjs/express",
    );
    expect(index).not.toBeNull();
    expect(index!.snippets.length).toBeGreaterThan(0);
    expect(index!.sourceUrl).toBe("https://expressjs.com/");
    expect(fetchGitHubContent).not.toHaveBeenCalled();
  });

  it("falls back to the GitHub README when the docs page has no fenced code", async () => {
    vi.mocked(fetchDocs).mockResolvedValue({
      content: PROSE_NO_CODE,
      url: "https://expressjs.com/",
      sourceType: "llms-txt",
    });
    vi.mocked(fetchGitHubContent).mockResolvedValue({
      content: README_WITH_CODE,
      url: "https://raw.githubusercontent.com/expressjs/express/master/README.md",
      sourceType: "github-readme",
    });
    const index = await buildIndex(
      "expressjs/express",
      undefined,
      "https://expressjs.com/",
      undefined,
      undefined,
      "https://github.com/expressjs/express",
    );
    expect(index).not.toBeNull();
    expect(index!.snippets.length).toBeGreaterThan(0);
    expect(fetchGitHubContent).toHaveBeenCalledWith("https://github.com/expressjs/express");
    expect(index!.sourceUrl).toContain("github");
  });

  it("returns an empty index (not a crash) when neither docs nor GitHub have code", async () => {
    vi.mocked(fetchDocs).mockResolvedValue({
      content: PROSE_NO_CODE,
      url: "https://expressjs.com/",
      sourceType: "llms-txt",
    });
    vi.mocked(fetchGitHubContent).mockResolvedValue(null);
    const index = await buildIndex(
      "expressjs/express",
      undefined,
      "https://expressjs.com/",
      undefined,
      undefined,
      "https://github.com/expressjs/express",
    );
    expect(index).not.toBeNull();
    expect(index!.snippets.length).toBe(0);
  });

  it("does not attempt the GitHub fallback when there is no githubUrl", async () => {
    vi.mocked(fetchDocs).mockResolvedValue({
      content: PROSE_NO_CODE,
      url: "https://example.com/",
      sourceType: "llms-txt",
    });
    const index = await buildIndex(
      "example/lib",
      undefined,
      "https://example.com/",
      undefined,
      undefined,
      undefined,
    );
    expect(index).not.toBeNull();
    expect(fetchGitHubContent).not.toHaveBeenCalled();
    expect(index!.snippets.length).toBe(0);
  });
});
