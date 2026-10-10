import { describe, it, expect } from "vitest";
import { singleFlight } from "./single-flight.js";
import { currentCallSignal, runWithCallSignal } from "../../utils/guard.js";

describe("singleFlight", () => {
  it("runs one job per key, shares it with joiners, and forgets it once settled", async () => {
    const map = new Map<string, Promise<number>>();
    let runs = 0;
    let release = (_v: number): void => {};
    const job = () => { runs++; return new Promise<number>((r) => { release = r; }); };
    const a = singleFlight(map, "k", job);
    const b = singleFlight(map, "k", job);
    expect(b).toBe(a);
    release(7);
    expect(await Promise.all([a, b])).toEqual([7, 7]);
    expect(runs).toBe(1);
    expect(map.has("k")).toBe(false);
  });

  it("forgets a failed job so the next call retries", async () => {
    const map = new Map<string, Promise<number>>();
    await expect(singleFlight(map, "k", async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    expect(await singleFlight(map, "k", async () => 1)).toBe(1);
  });

  it("runs the job outside the starting caller's cancellation scope", async () => {
    const caller = new AbortController();
    const seen = await runWithCallSignal(caller.signal, () =>
      singleFlight(new Map<string, Promise<AbortSignal | undefined>>(), "k", async () => currentCallSignal()));
    expect(seen).not.toBe(caller.signal);
    caller.abort();
    expect(seen?.aborted).toBe(false);
  });
});
