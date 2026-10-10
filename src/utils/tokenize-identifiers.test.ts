import { describe, it, expect } from "vitest";
import { tokenize, topicIdentifiers, identifierStems } from "./tokenize.js";

describe("topicIdentifiers", () => {
  it("keeps whole identifiers that tokenize() splits apart", () => {
    expect(topicIdentifiers("select_related prefetch_related")).toEqual(["select_related", "prefetch_related"]);
    expect(topicIdentifiers("vi.mock module mocking")).toEqual(["vi.mock"]);
    expect(topicIdentifiers("tokio::spawn tasks")).toEqual(["tokio::spawn"]);
    expect(topicIdentifiers("invalidateQueries after mutation")).toEqual(["invalidatequeries"]);
    expect(topicIdentifiers("@theme directive custom colors")).toEqual(["@theme"]);
  });

  it("keeps short acronyms that tokenize() drops", () => {
    expect(tokenize("KV namespace get put")).toEqual(["namespace"]);
    expect(topicIdentifiers("KV namespace get put")).toEqual(["kv"]);
    expect(topicIdentifiers("S3 upload to D1 or R2")).toEqual(["s3", "d1", "r2"]);
  });

  it("ignores plain words, lowercase two-letter words, versions and trailing punctuation", () => {
    expect(topicIdentifiers("row level security policies")).toEqual([]);
    expect(topicIdentifiers("go to the docs")).toEqual([]);
    expect(topicIdentifiers("migrate from 15.1 to v16")).toEqual([]);
    expect(topicIdentifiers("tailwind 3.x to 4.x upgrade")).toEqual([]);
    expect(topicIdentifiers("policies using auth.uid.")).toEqual(["auth.uid"]);
  });

  it("drops library names written with a .js/.ts suffix, keeps API identifiers", () => {
    expect(topicIdentifiers("Next.js middleware")).toEqual([]);
    expect(topicIdentifiers("Vue.js reactivity, Node.js streams, Express.js routing, three.js")).toEqual([]);
    expect(topicIdentifiers("process.env in Express.js")).toEqual(["process.env"]);
  });

  it("returns each identifier once", () => {
    expect(topicIdentifiers("useEffect vs useEffect cleanup")).toEqual(["useeffect"]);
  });
});

describe("identifierStems", () => {
  it("splits camelCase identifiers into stemmed words", () => {
    expect(identifierStems("invalidateQueries after mutation")).toEqual(["invalidat", "quer"]);
    expect(identifierStems("content collections defineCollection")).toEqual(["defin", "collection"]);
  });

  it("drops stop words, short stems and non-camelCase topics", () => {
    expect(identifierStems("useEffect cleanup")).toEqual(["effect"]);
    expect(identifierStems("setQueryData")).toEqual(["query", "data"]);
    expect(identifierStems("select_related vi.mock KV")).toEqual([]);
  });
});
