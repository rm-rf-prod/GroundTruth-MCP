import { describe, it, expect } from "vitest";
import { detectIntent } from "../intent-router.js";

describe("changelog route version", () => {
  it("passes the version named after the library", () => {
    const m = detectIntent({ query: "what's new in react 19" });
    expect(m.tool).toBe("gt_changelog");
    expect(m.args["version"]).toBe("19");
  });
  it("omits version when none is given", () => {
    const m = detectIntent({ query: "what's new in react" });
    expect(m.args["version"]).toBeUndefined();
  });
});
