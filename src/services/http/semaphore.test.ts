import { describe, it, expect } from "vitest";
import { MAX_CONCURRENT_FETCHES } from "../../constants.js";
import { hostSemaphore } from "./semaphore.js";

const PER_HOST = Math.max(2, Math.floor(MAX_CONCURRENT_FETCHES / 3));

describe("FetchSemaphore.acquire(signal)", () => {
  it("drops a queued waiter when its signal aborts, without taking a slot", async () => {
    const sem = hostSemaphore("https://abort-wait.example.com/")!;
    for (let i = 0; i < PER_HOST; i++) await sem.acquire();
    const caller = new AbortController();
    const waiting = sem.acquire(caller.signal);
    expect(sem.pending).toBe(1);
    caller.abort();
    await expect(waiting).rejects.toMatchObject({ name: "AbortError" });
    expect(sem.pending).toBe(0);
    for (let i = 0; i < PER_HOST; i++) sem.release();
    expect(sem.running).toBe(0);
  });

  it("rejects at once for a signal that is already aborted", async () => {
    const sem = hostSemaphore("https://pre-aborted.example.com/")!;
    await expect(sem.acquire(AbortSignal.abort())).rejects.toMatchObject({ name: "AbortError" });
    expect(sem.running).toBe(0);
  });
});
