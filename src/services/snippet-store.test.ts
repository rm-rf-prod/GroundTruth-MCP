import { describe, it, expect, vi, beforeEach } from "vitest";
import { SnippetStore } from "./snippet-store.js";
import type { Snippet, SnippetIndex } from "../types.js";

const makeSnippet = (title: string, language = "typescript"): Snippet => ({
  id: title.slice(0, 16),
  library: "react",
  title,
  description: `Desc for ${title}`,
  code: `// ${title}\nconst x = ${title.length};`,
  language,
  source: "https://react.dev",
  score: 0,
});

class FakeDisk {
  store = new Map<string, string>();
  async get(key: string): Promise<string | undefined> {
    return this.store.get(key);
  }
  async set(key: string, value: string): Promise<void> {
    this.store.set(key, value);
  }
  async has(key: string): Promise<boolean> {
    return this.store.has(key);
  }
}

describe("SnippetStore", () => {
  let store: SnippetStore;
  let disk: FakeDisk;

  beforeEach(() => {
    disk = new FakeDisk();
    store = new SnippetStore(disk as unknown as Parameters<typeof SnippetStore>[0] extends infer D ? D : never);
  });

  it("save + load roundtrip", async () => {
    const index: SnippetIndex = {
      library: "react",
      version: "19",
      sourceUrl: "https://react.dev",
      snippets: [makeSnippet("Hooks"), makeSnippet("RSC")],
      builtAt: "2026-05-26T00:00:00.000Z",
    };
    await store.save(index);
    const back = await store.load("react", "19");
    expect(back?.snippets.length).toBe(2);
    expect(back?.builtAt).toBe("2026-05-26T00:00:00.000Z");
  });

  it("load returns null when missing", async () => {
    const back = await store.load("unknown", null);
    expect(back).toBeNull();
  });

  it("query ranks against topic", async () => {
    const index: SnippetIndex = {
      library: "react",
      version: null,
      sourceUrl: "https://react.dev",
      snippets: [
        makeSnippet("Authentication Middleware"),
        makeSnippet("Routing"),
        makeSnippet("State Management"),
      ],
      builtAt: "x",
    };
    await store.save(index);
    const result = await store.query("react", null, "middleware auth", undefined, 5);
    expect(result?.snippets[0]?.title).toBe("Authentication Middleware");
  });

  it("query returns null when index missing", async () => {
    const result = await store.query("ghost", null, "anything");
    expect(result).toBeNull();
  });

  it("query filters by language", async () => {
    const index: SnippetIndex = {
      library: "react",
      version: null,
      sourceUrl: "https://react.dev",
      snippets: [
        makeSnippet("TS Snippet", "typescript"),
        makeSnippet("Py Snippet", "python"),
      ],
      builtAt: "x",
    };
    await store.save(index);
    const tsOnly = await store.query("react", null, "", "typescript", 5);
    expect(tsOnly?.snippets.every((s) => s.language === "typescript")).toBe(true);
  });

  it("uses latest as default version key", async () => {
    const index: SnippetIndex = {
      library: "react",
      version: null,
      sourceUrl: "x",
      snippets: [makeSnippet("default")],
      builtAt: "y",
    };
    await store.save(index);
    expect(await store.has("react", null)).toBe(true);
    expect(await store.has("react", "19")).toBe(false);
  });
});
