import { describe, it, expect } from "vitest";
import { replaceUntilStable } from "./replace-stable.js";

describe("replaceUntilStable", () => {
  it("removes a tag rebuilt by the first removal", () => {
    expect(replaceUntilStable("<scr<script></script>ipt>alert(1)", /<script><\/script>/g)).toBe("<script>alert(1)");
  });

  it("removes fully nested tag fragments", () => {
    expect(replaceUntilStable("<scr<b>ipt>x", /<b>/g)).toBe("<script>x");
  });

  it("supports a replacement string and stable input", () => {
    expect(replaceUntilStable("aaa", /aa/g, "b")).toBe("ba");
    expect(replaceUntilStable("clean", /x/g)).toBe("clean");
  });
});
