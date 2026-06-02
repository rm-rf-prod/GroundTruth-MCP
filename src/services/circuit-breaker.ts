import { CIRCUIT_BREAKER_THRESHOLD, CIRCUIT_BREAKER_RESET_MS } from "../constants.js";

type CircuitState = "closed" | "open" | "half-open";

interface BreakerEntry {
  state: CircuitState;
  failures: number;
  lastFailure: number;
  lastSuccess: number;
  /** Single-flight guard: true while a half-open probe is in flight. */
  probePending: boolean;
}

const breakers = new Map<string, BreakerEntry>();

const MAX_BREAKERS = 500;

function getEntry(domain: string): BreakerEntry {
  let entry = breakers.get(domain);
  if (!entry) {
    if (breakers.size >= MAX_BREAKERS) {
      // Evict the entry with the oldest last-activity timestamp
      let oldestKey = "";
      let oldestTime = Infinity;
      for (const [key, e] of breakers) {
        const lastActivity = Math.max(e.lastFailure, e.lastSuccess);
        if (lastActivity < oldestTime) { oldestTime = lastActivity; oldestKey = key; }
      }
      if (oldestKey) breakers.delete(oldestKey);
    }
    entry = { state: "closed", failures: 0, lastFailure: 0, lastSuccess: 0, probePending: false };
    breakers.set(domain, entry);
  }
  return entry;
}

export function extractDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
}

export function isCircuitOpen(domain: string): boolean {
  const entry = getEntry(domain);

  if (entry.state === "closed") return false;

  if (entry.state === "open") {
    if (Date.now() - entry.lastFailure >= CIRCUIT_BREAKER_RESET_MS) {
      entry.state = "half-open";
      entry.probePending = true;
      return false; // this caller owns the single probe
    }
    return true;
  }

  // half-open: gate subsequent callers so only one probe is in flight at a time.
  if (entry.probePending) return true; // probe already running — fail-fast
  // Defensive: half-open with probePending=false should not occur in normal flow
  // (recordSuccess/recordFailure both clear it AND leave half-open); guard against
  // a future code path or an external resetCircuit race.
  return false;
}

export function recordSuccess(domain: string): void {
  const entry = getEntry(domain);
  entry.failures = 0;
  entry.state = "closed";
  entry.probePending = false;
  entry.lastSuccess = Date.now();
  // Reset the failure clock so the next reset window measures from a real failure.
  entry.lastFailure = 0;
}

export function recordFailure(domain: string): void {
  const entry = getEntry(domain);

  // A failed probe while half-open re-opens the circuit cleanly and restarts the
  // reset window, without unbounded failure accumulation. Recovery is retried
  // after CIRCUIT_BREAKER_RESET_MS via isCircuitOpen's half-open transition.
  if (entry.state === "half-open") {
    entry.state = "open";
    entry.lastFailure = Date.now();
    entry.probePending = false;
    return;
  }

  entry.failures++;
  entry.lastFailure = Date.now();

  if (entry.failures >= CIRCUIT_BREAKER_THRESHOLD) {
    entry.state = "open";
  }
}

export function getCircuitState(domain: string): CircuitState {
  return getEntry(domain).state;
}

export function resetCircuit(domain: string): void {
  breakers.delete(domain);
}

export function resetAllCircuits(): void {
  breakers.clear();
}

export function getCircuitSummary(): { open: number; halfOpen: number; closed: number } {
  let open = 0;
  let halfOpen = 0;
  let closed = 0;
  for (const entry of breakers.values()) {
    if (entry.state === "open") {
      if (Date.now() - entry.lastFailure >= CIRCUIT_BREAKER_RESET_MS) {
        halfOpen++;
      } else {
        open++;
      }
    } else if (entry.state === "half-open") {
      halfOpen++;
    } else {
      closed++;
    }
  }
  return { open, halfOpen, closed };
}
