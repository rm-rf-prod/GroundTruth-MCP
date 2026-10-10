import { MAX_CONCURRENT_FETCHES } from "../../constants.js";
import { log } from "../../utils/logger.js";

/**
 * Global fetch semaphore — caps total concurrent outbound HTTP requests.
 * Prevents request storms from tools like gt_auto_scan (20 libs x 6 fetches each)
 * that cause upstream 429s and MCP client 529 overloaded errors.
 */
class FetchSemaphore {
  private active = 0;
  private readonly queue: Array<() => void> = [];
  private readonly max: number;

  constructor(max: number) {
    this.max = max;
  }

  /** `signal` aborting while queued drops the waiter, so a cancelled call stops holding its place in line. */
  async acquire(signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    if (this.active < this.max) {
      this.active++;
      return;
    }
    return new Promise<void>((resolve, reject) => {
      const grant = (): void => {
        signal?.removeEventListener("abort", onAbort);
        this.active++;
        resolve();
      };
      const onAbort = (): void => {
        const i = this.queue.indexOf(grant);
        if (i >= 0) this.queue.splice(i, 1);
        reject(signal?.reason);
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      this.queue.push(grant);
    });
  }

  release(): void {
    // Fail-safe: a spurious/double release must not drive active negative —
    // that would let acquire() skip the queue and exceed MAX_CONCURRENT_FETCHES.
    if (this.active <= 0) {
      log({ level: "warn", msg: "FetchSemaphore.release_underflow", active: this.active });
      return;
    }
    this.active--;
    const next = this.queue.shift();
    if (next) next();
  }

  get pending(): number {
    return this.queue.length;
  }

  get running(): number {
    return this.active;
  }
}

export const fetchSemaphore = new FetchSemaphore(MAX_CONCURRENT_FETCHES);

/**
 * Per-host bulkhead layered under the global cap. The global semaphore alone
 * let one slow-dripping domain hold most of the 12 slots during a fan-out
 * (gt_auto_scan probes many libraries at once), starving every other host.
 * Sized so no single host can take more than a third of the global budget.
 */
const PER_HOST_LIMIT = Math.max(2, Math.floor(MAX_CONCURRENT_FETCHES / 3));
const hostSemaphores = new Map<string, FetchSemaphore>();

export function hostSemaphore(url: string): FetchSemaphore | null {
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return null;
  }
  let sem = hostSemaphores.get(host);
  if (!sem) {
    // Bounded: a long session touching thousands of hosts must not leak entries.
    if (hostSemaphores.size >= 500) {
      for (const [key, value] of hostSemaphores) {
        if (value.running === 0 && value.pending === 0) hostSemaphores.delete(key);
      }
    }
    sem = new FetchSemaphore(PER_HOST_LIMIT);
    hostSemaphores.set(host, sem);
  }
  return sem;
}
