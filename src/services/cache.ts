import type { LibraryMatch } from "../types.js";
import { LRUCache } from "./lru-cache.js";
import { DiskCache } from "./disk-cache.js";

export { LRUCache } from "./lru-cache.js";
export { DiskCache } from "./disk-cache.js";

// Shared cache instances
export const docCache = new LRUCache<string>(200);
export const resolveCache = new LRUCache<LibraryMatch>(500);
export const llmsProbeCache = new LRUCache<{ llmsTxtUrl?: string; llmsFullTxtUrl?: string }>(500);

// Persistent disk cache — survives across npx invocations
export const diskDocCache = new DiskCache();
