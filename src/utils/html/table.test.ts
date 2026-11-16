import { describe, it, expect } from "vitest";
import { convertTable } from "./table.js";

describe("convertTable cells", () => {
  it("escapes pipes and flattens breaks", () => {
    const out = convertTable("<tr><th>a</th><th>b</th></tr><tr><td>string | number</td><td>l1<br>l2</td></tr>");
    expect(out).toContain("| string \\| number | l1 l2 |");
  });
});
