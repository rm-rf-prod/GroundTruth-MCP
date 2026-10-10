import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../services/fetcher.js", () => ({
  fetchDocs: vi.fn(),
  fetchGitHubReleases: vi.fn(),
  fetchAsMarkdownRace: vi.fn(),
  isIndexContent: vi.fn(() => false),
  rankIndexLinks: vi.fn(() => []),
}));

vi.mock("../sources/registry.js", () => ({ lookupById: vi.fn() }));

import { fetchBestPractice } from "./audit-fixes.js";
import { fetchAsMarkdownRace } from "../services/fetcher.js";
import { PYTHON_FIX_URLS } from "../sources/audit-fix-urls.js";

// Both Python pages pass the evidence gate on "python" alone, which is the trap:
// the security page must not answer findings it does not cover.
const PAGE = Array.from(
  { length: 8 },
  (_, i) => `Python section ${i}: avoid a bare except clause, catch specific exception types; ` +
    `never unpickle untrusted data with pickle, it allows arbitrary code execution.`,
).join("\n\n");

beforeEach(() => {
  vi.mocked(fetchAsMarkdownRace).mockReset().mockImplementation(async (url: string) =>
    url === PYTHON_FIX_URLS.security || url === PYTHON_FIX_URLS.style ? PAGE : "",
  );
});

function fetchedUrls(): string[] {
  return vi.mocked(fetchAsMarkdownRace).mock.calls.map(([url]) => url);
}

describe("fetchBestPractice Python guidance", () => {
  it.each([
    "Python bare except anti-pattern exception handling",
    "Python mutable default argument anti-pattern",
    "Python logging best practices production print",
  ])("non-security finding %s resolves to PEP 8, not the security page", async (query) => {
    const out = await fetchBestPractice(query, 2000);
    expect(out).toContain(`_Source: ${PYTHON_FIX_URLS.style}`);
    expect(fetchedUrls()).not.toContain(PYTHON_FIX_URLS.security);
  });

  it("security finding still prefers the security page", async () => {
    const out = await fetchBestPractice("Python pickle deserialization RCE security OWASP", 2000);
    expect(out).toContain(`_Source: ${PYTHON_FIX_URLS.security}`);
  });
});
