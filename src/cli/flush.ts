import { diskDocCache } from "../services/cache.js";

// Tools write the disk cache fire-and-forget, and the CLI exits right after the
// command. Without waiting, writes still between the tmp write and the rename
// are lost and leave orphaned .tmp files.

let pruning: Promise<unknown> = Promise.resolve();

/**
 * Trim the disk cache alongside the command. Not awaited here: flushDiskWrites
 * lets it finish within the same cap, so a fast command still completes it.
 */
export function pruneInBackground(): void {
  pruning = diskDocCache.prune(1000).catch(() => 0);
}

/** Wait for in-flight disk-cache writes and the prune, at most capMs so a stuck disk cannot hang the CLI. */
export async function flushDiskWrites(capMs = 2_000): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const cap = new Promise<void>((resolve) => { timer = setTimeout(resolve, capMs); });
  await Promise.race([Promise.all([diskDocCache.flush(), pruning]), cap]);
  clearTimeout(timer);
}
