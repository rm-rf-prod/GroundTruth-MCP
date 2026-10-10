import { describe, it, expect, vi } from "vitest";

vi.mock("../utils/logger.js", () => ({ log: vi.fn() }));

import { rankLinksForTopic, extractInternalLinks, buildTopicUrls } from "./links.js";

describe("rankLinksForTopic version penalty (ACC-03)", () => {
  it("ranks the newest versioned tree above an older one when both are present", () => {
    const links = ["v6", "v7"].map((v) => {
      const url = `https://www.prisma.io/docs/orm/${v}/prisma-schema/data-model/relations/one-to-many-relations`;
      return { url, text: url };
    });
    const ranked = rankLinksForTopic(links, "one-to-many relations");
    expect(ranked[0]?.url).toContain("/orm/v7/");
    expect(ranked[0]!.score).toBeGreaterThan(ranked[1]!.score);
  });

  it("still penalizes a lone versioned tree next to unversioned docs", () => {
    const links = [
      { url: "https://docs.example.com/v1/guide/routing", text: "Routing" },
      { url: "https://docs.example.com/guide/routing", text: "Routing" },
    ];
    expect(rankLinksForTopic(links, "routing")[0]?.url).toBe("https://docs.example.com/guide/routing");
  });
});

describe("github.com-hosted docs (TOK-2)", () => {
  it("reads repo files raw instead of through GitHub's HTML page", () => {
    const readme = "See [jwtVerify](https://github.com/panva/jose/blob/main/docs/jwt/verify/functions/jwtVerify.md).";
    expect(extractInternalLinks(readme, "https://github.com/panva/jose")).toEqual([
      { url: "https://raw.githubusercontent.com/panva/jose/main/docs/jwt/verify/functions/jwtVerify.md", text: "jwtVerify" },
    ]);
  });

  it("guesses no doc-site slugs on a repo URL", () => {
    expect(buildTopicUrls("https://github.com/panva/jose", "jwt verify")).toEqual([]);
  });
});
