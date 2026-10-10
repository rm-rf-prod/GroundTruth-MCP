import * as guard from "../../utils/guard.js";

/** Never aborts: work that several tool calls share must outlive any one of them. */
const SHARED = new AbortController().signal;

/** Run `fn` outside the current tool call's cancellation scope (shared or background work). */
export function detached<T>(fn: () => Promise<T>): Promise<T> {
  // `in`, not a named import: many tool tests mock guard.js without this export.
  return "runWithCallSignal" in guard ? guard.runWithCallSignal(SHARED, fn) : fn();
}

/**
 * One `fn` per key at a time: concurrent callers join the running promise. It
 * runs detached, so the caller that happened to start it cannot cancel it for
 * the others.
 */
export function singleFlight<T>(map: Map<string, Promise<T>>, key: string, fn: () => Promise<T>): Promise<T> {
  const inFlight = map.get(key);
  if (inFlight) return inFlight;
  const pending: Promise<T> = detached(fn).finally(() => {
    if (map.get(key) === pending) map.delete(key);
  });
  map.set(key, pending);
  return pending;
}
