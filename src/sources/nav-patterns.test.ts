import { describe, it, expect } from "vitest";
import { NAV_FOOTER_PATTERNS } from "./nav-patterns.js";

const strip = (text: string): string => NAV_FOOTER_PATTERNS.reduce((out, re) => out.replace(re, ""), text);

describe("NAV_FOOTER_PATTERNS cost", () => {
  // Each prefix is the literal some pattern starts with; a hostile page can follow
  // it with a whitespace run that a quadratic pattern rescans from every offset.
  const prefixes = ["", "[", "Search", "Updated", "Copyright", "←", "[a](http://", "[a](/cdn-cgi/l/"];
  const runs = [" ", "\n", "\t", " \n"];
  const inputs = prefixes.flatMap((p) => runs.flatMap((w) => [
    p + w.repeat(200_000 / w.length) + "x",
    (p + w).repeat(Math.floor(200_000 / (p.length + w.length))),
  ]));

  it.each(NAV_FOOTER_PATTERNS.map((re, i) => [i, re] as const))("pattern %i stays linear on 200K whitespace", (_i, re) => {
    const start = performance.now();
    for (const input of inputs) input.replace(re, "");
    // A quadratic pattern takes tens of seconds here; linear ones a few ms.
    expect(performance.now() - start).toBeLessThan(1_000);
  });
});

describe("NAV_FOOTER_PATTERNS behavior", () => {
  it("strips search boxes without gluing the next line on", () => {
    const out = strip("Intro\n\nSearch docs\n\n## Heading\n[ Search documentation ]\nBody");
    expect(out).not.toMatch(/Search (docs|documentation)/);
    expect(out).toMatch(/^## Heading$/m);
    expect(out).not.toContain("[");
  });

  it("strips the Search ... box", () => {
    expect(strip("a [Search ...] b")).toBe("a  b");
  });

  it("strips 'Updated' metadata lines but never the lines after them", () => {
    expect(strip("Body\nUpdated: January 5, 2024\nMore")).toBe("Body\n\nMore");
    expect(strip("Updated\nNew APIs landed in 2024")).toContain("New APIs landed in 2024");
  });

  it("strips copyright lines with and without the sign", () => {
    expect(strip("x\nCopyright © 2024 Acme Corp.\ny")).toBe("x\n\ny");
    expect(strip("x\nCopyright  2024 Acme\ny")).toBe("x\n\ny");
  });

  it("strips the arrow pager row", () => {
    expect(strip("a\n← Previous | Next →\nb")).toBe("a\n\nb");
  });

  it("strips cdn-cgi placeholder links", () => {
    expect(strip("Mail [hidden](/cdn-cgi/l/email-protection#abc) now")).toBe("Mail  now");
  });
});
