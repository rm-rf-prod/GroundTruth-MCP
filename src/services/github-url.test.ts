import { describe, it, expect } from "vitest";
import { gitHubDocFile, hasDotSegment } from "./github-url.js";

describe("gitHubDocFile", () => {
  it.each([
    ["https://github.com/panva/jose", "README.md"],
    ["https://github.com/dip/cmdk#readme", "README.md"],
    ["https://github.com/panva/jose/tree/main#documentation", "README.md"],
    ["https://github.com/ggml-org/llama.cpp/tree/master/docs", "README.md"],
    ["https://github.com/serilog/serilog/wiki", "README.md"],
    ["https://github.com/websockets/ws/blob/master/doc/ws.md", "doc/ws.md"],
    ["https://github.com/o/r/blob/main/docs/Getting%20Started.md?plain=1#L3", "docs/Getting%20Started.md"],
  ])("routes %s to %s", (url, path) => {
    expect(gitHubDocFile(url)?.path).toBe(path);
  });

  it("builds the repo URL from the parsed pathname", () => {
    expect(gitHubDocFile("https://github.com/o/r/blob/main/x/../y.md")).toEqual({ repoUrl: "https://github.com/o/r", path: "y.md" });
  });

  it.each([
    "https://github.com/o/r/blob/main/../../../../user",
    "https://github.com/o/r/blob/main/%2e%2e/%2e%2e/%2e%2e/%2e%2e/user",
    "https://github.com/o/r/issues/1",
    "https://github.com/o/r/blob/main",
    "https://github.com/o",
    "https://docs.github.com/en/rest",
    "not a url",
  ])("leaves %s to the page fetch", (url) => {
    expect(gitHubDocFile(url)).toBeNull();
  });
});

describe("hasDotSegment", () => {
  it.each(["..", "a/../b", "./x", "%2e%2e/x", "a%2F..", "a\\..\\b", "%252e%252e"])("flags %s", (p) => {
    expect(hasDotSegment(p)).toBe(true);
  });

  it.each(["docs/api.md", "socket.io", "a..b/c", "v1.2/x.md", "Getting%20Started.md"])("allows %s", (p) => {
    expect(hasDotSegment(p)).toBe(false);
  });
});
