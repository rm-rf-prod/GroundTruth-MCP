import { describe, it, expect } from "vitest";
import { LIBRARY_REGISTRY, lookupById, lookupByAlias } from "./registry.js";
import { buildTopicUrls } from "../services/links.js";

function entry(id: string) {
  const e = lookupById(id);
  if (!e) throw new Error(`missing registry entry ${id}`);
  return e;
}

// npm packages that are deprecated, abandoned or superseded (checked against
// registry.npmjs.org). npmPackage drives lockfile version detection.
const STALE_NPM = ["lucia", "@react-email/components", "nats", "@shadcn/ui", "@xenova/transformers", "contentlayer", "react-router-dom", "open-webui", "prom-client"];

describe("registry package names", () => {
  it("no entry points npmPackage at a deprecated or superseded package", () => {
    const hits = LIBRARY_REGISTRY.filter((e) => e.npmPackage && STALE_NPM.includes(e.npmPackage));
    expect(hits.map((e) => `${e.id} ${e.npmPackage}`)).toEqual([]);
  });

  it.each([
    ["shadcn/ui", "shadcn"],
    ["remix-run/react-router", "react-router"],
    ["jsx-email/react-email", "react-email"],
    ["contentlayer/contentlayer", "contentlayer2"],
    ["huggingface/transformers.js", "@huggingface/transformers"],
    ["nats-io/nats.js", "@nats-io/transport-node"],
    ["prometheus/client_js", "@prometheus-io/client"],
  ])("%s uses the maintained npm package %s", (id, pkg) => {
    expect(entry(id).npmPackage).toBe(pkg);
  });

  it("lucia has no npm package (deprecated, no successor)", () => {
    expect(entry("lucia-auth/lucia").npmPackage).toBeUndefined();
  });

  it("open-webui is a PyPI package, not npm", () => {
    const e = entry("open-webui/open-webui");
    expect(e.npmPackage).toBeUndefined();
    expect(e.pypiPackage).toBe("open-webui");
  });

  it.each([
    ["@shadcn/ui", "shadcn/ui"],
    ["react-router-dom", "remix-run/react-router"],
    ["@react-email/components", "jsx-email/react-email"],
    ["contentlayer", "contentlayer/contentlayer"],
    ["lucia", "lucia-auth/lucia"],
    ["@xenova/transformers", "huggingface/transformers.js"],
    ["nats", "nats-io/nats.js"],
    ["open-webui", "open-webui/open-webui"],
    ["junit 5", "junit-team/junit5"],
    ["prom-client", "prometheus/client_js"],
  ])("old name %s still resolves to %s", (alias, id) => {
    expect(lookupByAlias(alias)?.id).toBe(id);
  });
});

describe("registry doc versions and facts", () => {
  it("preact points at the v11 guide", () => {
    const e = entry("preactjs/preact");
    const urls = [e.docsUrl, ...(e.bestPracticesPaths ?? []), ...(e.urlPatterns ?? [])];
    expect(urls.every((u) => !u.includes("/guide/v10/"))).toBe(true);
    expect(e.docsUrl).toContain("/guide/v11/");
  });

  it("JUnit is not pinned to major 5 by name", () => {
    expect(entry("junit-team/junit5").name).toBe("JUnit");
  });

  it("OpenAPI describes 3.2 and drops the dead swagger.io v3_0 pattern", () => {
    const e = entry("openapi/spec");
    expect(e.description).toContain("3.2");
    expect((e.urlPatterns ?? []).some((p) => p.includes("v3_0"))).toBe(false);
  });

  it.each(["google/adk-python", "openai/openai-agents-python"])("%s launch year is 2025", (id) => {
    expect(entry(id).description).not.toContain("2026");
    expect(entry(id).description).toContain("2025");
  });

  it("sqlalchemy docsUrl keeps the trailing slash (without it the site redirects to notfound.html)", () => {
    expect(entry("sqlalchemy/sqlalchemy").docsUrl.endsWith("/")).toBe(true);
  });

  it("opik docsUrl is not the bare /docs/opik/ root (it redirects to a 404 opik.md)", () => {
    expect(entry("comet-ml/opik").docsUrl).not.toMatch(/\/docs\/opik\/?$/);
  });
});

describe("registry reachability (deep-fetch tries the first 6 topic URLs)", () => {
  function firstTopicUrls(id: string, topic: string): string[] {
    const e = entry(id);
    return buildTopicUrls(e.docsUrl, topic, e.urlPatterns).slice(0, 6);
  }

  it("Go standard library packages are reachable on pkg.go.dev", () => {
    expect(firstTopicUrls("golang/docs", "context")).toContain("https://pkg.go.dev/context");
    expect(firstTopicUrls("golang/docs", "net http")).toContain("https://pkg.go.dev/net/http");
  });

  it("pandas user guide pages are reachable", () => {
    expect(firstTopicUrls("pandas-dev/pandas", "groupby")).toContain("https://pandas.pydata.org/docs/user_guide/groupby.html");
  });

  it("OpenAPI topics reach the OAI learn guide (the spec itself is one page)", () => {
    expect(firstTopicUrls("openapi/spec", "paths")).toContain("https://learn.openapis.org/specification/paths.html");
  });
});
