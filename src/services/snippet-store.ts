import type { Snippet, SnippetIndex } from "../types.js";
import { DiskCache } from "./cache.js";
import { CACHE_TTLS } from "../constants.js";
import { rankSnippets } from "../utils/snippet-extract.js";

const SNIPPET_TTL_MS = CACHE_TTLS.CHANGELOG;

function indexKey(library: string, version: string | null): string {
  return `snippets:${library}:${version ?? "latest"}`;
}

export class SnippetStore {
  private readonly disk: DiskCache;

  constructor(disk = new DiskCache()) {
    this.disk = disk;
  }

  async save(index: SnippetIndex): Promise<void> {
    const key = indexKey(index.library, index.version);
    await this.disk.set(key, JSON.stringify(index), SNIPPET_TTL_MS);
  }

  async load(library: string, version: string | null): Promise<SnippetIndex | null> {
    const key = indexKey(library, version);
    const raw = await this.disk.get(key);
    if (!raw) return null;
    try {
      const parsed: unknown = JSON.parse(raw);
      // An old-schema or truncated cache file can parse to a non-conforming
      // object; reject it as a cache-miss so query()/rankSnippets never receive
      // a missing snippets array (mirrors the TS-004 guard in cache.ts).
      if (
        typeof parsed !== "object" ||
        parsed === null ||
        typeof (parsed as Record<string, unknown>)["library"] !== "string" ||
        typeof (parsed as Record<string, unknown>)["sourceUrl"] !== "string" ||
        typeof (parsed as Record<string, unknown>)["builtAt"] !== "string" ||
        !Array.isArray((parsed as Record<string, unknown>)["snippets"])
      ) {
        return null;
      }
      return parsed as SnippetIndex;
    } catch {
      return null;
    }
  }

  async has(library: string, version: string | null): Promise<boolean> {
    return this.disk.has(indexKey(library, version));
  }

  async query(
    library: string,
    version: string | null,
    topic: string,
    language?: string,
    max = 10,
  ): Promise<{ snippets: Snippet[]; sourceUrl: string; builtAt: string } | null> {
    const index = await this.load(library, version);
    if (!index) return null;
    const ranked = rankSnippets(index.snippets, topic, language, max);
    return { snippets: ranked, sourceUrl: index.sourceUrl, builtAt: index.builtAt };
  }
}

export const snippetStore = new SnippetStore();
