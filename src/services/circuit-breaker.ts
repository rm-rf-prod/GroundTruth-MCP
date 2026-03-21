import { CIRCUIT_BREAKER_THRESHOLD, CIRCUIT_BREAKER_RESET_MS } from "../constants.js";

type CircuitState = "closed" | "open" | "half-open";

interface BreakerEntry {
  state: CircuitState;
  failures: number;
  lastFailure: number;
  lastSuccess: number;
}

const breakers = new Map<string, BreakerEntry>();

function getEntry(domain: string): BreakerEntry {
  let entry = breakers.get(domain);
  if (!entry) {
    entry = { state: "closed", failures: 0, lastFailure: 0, lastSuccess: 0 };
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
      return false;
    }
    return true;
  }

  return false;
}

export function recordSuccess(domain: string): void {
  const entry = getEntry(domain);
  entry.failures = 0;
  entry.state = "closed";
  entry.lastSuccess = Date.now();
}

export function recordFailure(domain: string): void {
  const entry = getEntry(domain);
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
