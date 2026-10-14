import { readFileSync } from "node:fs";
import { describe, it, expect } from "vitest";
import { detectLibrary, stripNoise } from "./detect.js";

const fixture = (name: string): string[] =>
  readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), "utf8")
    .split("\n")
    .filter((l) => l.trim() !== "" && !l.startsWith("#"));

const detect = (q: string): string | undefined => detectLibrary(stripNoise(q), q)?.id;

// Registry growth must not turn ordinary phrases into library hits, nor stop
// real library names from resolving. Both corpora run with no network.
describe("detectLibrary corpora", () => {
  it("detects no library in generic developer phrases", () => {
    const hits = fixture("routing-negative.txt")
      .map((q) => `${q} -> ${detect(q) ?? ""}`)
      .filter((l) => !l.endsWith("-> "));
    expect(hits).toEqual([]);
  });

  it("detects no library in generic phrases passed without noise stripping", () => {
    const hits = fixture("routing-negative.txt").filter((q) => detectLibrary(q) !== null);
    expect(hits).toEqual([]);
  });

  it("detects the registry id each library-naming query names", () => {
    const misses = fixture("routing-positive.tsv")
      .map((l) => l.split("\t") as [string, string])
      .filter(([q, id]) => detect(q) !== id)
      .map(([q, id]) => `${q} -> want ${id}, got ${detect(q) ?? "null"}`);
    expect(misses).toEqual([]);
  });

  it("routes a query in well under 15 ms on average", () => {
    const queries = [...fixture("routing-negative.txt"), ...fixture("routing-positive.tsv").map((l) => l.split("\t")[0] ?? "")];
    detect("warm up");
    const t0 = performance.now();
    for (const q of queries) detect(q);
    expect((performance.now() - t0) / queries.length).toBeLessThan(15);
  });

  it("stays under 15 ms on a 2000-character query of repeated ordinary words", () => {
    for (const word of ["click ", "rich text ", "Click "]) {
      const q = word.repeat(Math.ceil(2000 / word.length)).slice(0, 2000);
      // Best of three: one slow run on a loaded machine is noise, not a regression.
      const runs = [0, 1, 2].map(() => {
        const t0 = performance.now();
        detect(q);
        return performance.now() - t0;
      });
      expect(Math.min(...runs)).toBeLessThan(30);
    }
  });
});

describe("detectLibrary corroboration of ordinary-word aliases", () => {
  it("ignores an ordinary-word alias with no supporting context", () => {
    expect(detect("handle click events")).toBeUndefined();
    expect(detect("rich text editing")).toBeUndefined();
    expect(detect("next steps for the deploy")).toBeUndefined();
  });

  it("accepts it next to a matching ecosystem word", () => {
    expect(detect("click options in python")).toBe("pallets/click");
    expect(detect("cron jobs in node")).toBe("node-cron/node-cron");
  });

  it("rejects an ecosystem word from a different language", () => {
    expect(detect("click handlers in typescript")).not.toBe("pallets/click");
  });

  it("accepts it when written as a name: Capitalised mid-sentence or quoted", () => {
    expect(detect("How do I use Click groups")).toBe("pallets/click");
    expect(detect("tables with `rich`")).toBe("Textualize/rich");
    expect(detect("Click events are not firing")).toBeUndefined();
  });

  it("accepts it with a library anchor, a version, or only request words", () => {
    expect(detect("the click library for cli args")).toBe("pallets/click");
    expect(detect("help me migrate next from 14 to 15")).toBe("vercel/next.js");
    expect(detect("what's new in next")).toBe("vercel/next.js");
    expect(detect("docs for spring")).toBe("spring-projects/spring-boot");
    expect(detect("passkeys")).toBeUndefined();
  });

  it("accepts a distinctive word from the entry's own metadata", () => {
    expect(detect("hypothesis property based testing")).toBe("HypothesisWorks/hypothesis");
    expect(detect("modal gpu functions")).toBe("modal-labs/modal");
  });

  it("accepts a brand-plus-qualifier alias made of ordinary words", () => {
    expect(detect("ray serve deployment")).toBe("ray-project/ray");
    expect(detect("effect-ts layers")).toBe("effect-ts/effect");
  });
});

describe("detectLibrary matching", () => {
  it("never matches a substring of an alias, id or org", () => {
    expect(detect("groundtruth this project")).toBeUndefined();
    expect(detect("handle forms")).toBeUndefined();
    expect(detect("toast notifications")).toBeUndefined();
  });

  it("prefers the longest phrase and a library over a language", () => {
    expect(detect("expo router dynamic routes")).toBe("expo/expo-router");
    expect(detect("rust tokio spawn a task")).toBe("tokio-rs/tokio");
  });

  it("prefers the first-named of two libraries: the subject usually comes first", () => {
    expect(detect("zod with react")).toBe("colinhacks/zod");
    expect(detect("prisma with postgresql")).toBe("prisma/prisma");
    expect(detect("jest mocks in react")).toBe("jestjs/jest");
    expect(detect("drizzle with postgres")).toBe("drizzle-team/drizzle-orm");
  });

  it("prefers a later name that extends the first one", () => {
    expect(detect("how to run drizzle migrations with drizzle-kit")).toBe("drizzle-team/drizzle-kit");
  });

  it("matches separator and version variants of a name", () => {
    expect(detect("next js app router")).toBe("vercel/next.js");
    expect(detect("vue3 composition api")).toBe("vuejs/vue");
  });

  it("keeps hyphenated names intact through noise stripping", () => {
    expect(detect("browser-use python agent")).toBe("browser-use/browser-use");
  });

  it("reports the registry key as alias and the query words as surface", () => {
    expect(detectLibrary("date fns format")).toMatchObject({ id: "date-fns/date-fns", alias: "date-fns", surface: "date fns" });
  });

  it("survives tokens that are Object prototype keys", () => {
    expect(() => detect("react constructor toString __proto__")).not.toThrow();
  });
});
