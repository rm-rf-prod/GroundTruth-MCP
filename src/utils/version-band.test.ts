import { describe, it, expect } from "vitest";
import { sliceVersionBand } from "./version-band.js";

describe("sliceVersionBand dated headings", () => {
  it("ignores day and month parts of dates", () => {
    const md = "## 3.2.0 (2024-03-15)\n- a\n\n## 15.0.0\n- big\n\n## 2.0.0 (2020-01-02)\n- old";
    const out = sliceVersionBand(md, "15", "15");
    expect(out).toContain("15.0.0");
    expect(out).not.toContain("3.2.0");
    expect(out).not.toContain("2.0.0");
  });
});
