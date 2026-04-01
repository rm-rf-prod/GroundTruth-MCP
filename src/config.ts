export interface GTConfig {
  tokenLimit: number;
  maxTokenLimit: number;
  cacheTtlMs: number;
  fetchTimeoutMs: number;
  deepFetchMaxPages: number;
  deepFetchRelevanceThreshold: number;
  deepFetchTimeoutMs: number;
  maxConcurrentFetches: number;
  toolTimeoutMs: number;
  swrStaleTtlMs: number;
  circuitBreakerThreshold: number;
  circuitBreakerResetMs: number;
  logFormat: "json" | "text";
  logLevel: "debug" | "info" | "warn" | "error";
  httpPort: string | undefined;
}

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const parsed = parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new Error(`Invalid ${name}: "${raw}" -- must be a non-negative integer`);
  }
  return parsed;
}

function enumEnv<T extends string>(name: string, fallback: T, allowed: readonly T[]): T {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  if (!allowed.includes(raw as T)) {
    throw new Error(`Invalid ${name}: "${raw}" -- must be one of: ${allowed.join(", ")}`);
  }
  return raw as T;
}

export const config: Readonly<GTConfig> = Object.freeze({
  tokenLimit: intEnv("GT_TOKEN_LIMIT", 8000),
  maxTokenLimit: intEnv("GT_MAX_TOKEN_LIMIT", 20000),
  cacheTtlMs: intEnv("GT_CACHE_TTL_MS", 30 * 60 * 1000),
  fetchTimeoutMs: intEnv("GT_FETCH_TIMEOUT_MS", 15_000),
  deepFetchMaxPages: intEnv("GT_DEEP_FETCH_MAX_PAGES", 8),
  deepFetchRelevanceThreshold: 0.3,
  deepFetchTimeoutMs: intEnv("GT_DEEP_FETCH_TIMEOUT_MS", 25_000),
  maxConcurrentFetches: intEnv("GT_MAX_CONCURRENT_FETCHES", 12),
  toolTimeoutMs: intEnv("GT_TOOL_TIMEOUT_MS", 55_000),
  swrStaleTtlMs: intEnv("GT_SWR_STALE_TTL_MS", 60 * 60 * 1000),
  circuitBreakerThreshold: intEnv("GT_CIRCUIT_BREAKER_THRESHOLD", 3),
  circuitBreakerResetMs: intEnv("GT_CIRCUIT_BREAKER_RESET_MS", 60_000),
  logFormat: enumEnv("GT_LOG_FORMAT", "text", ["json", "text"] as const),
  logLevel: enumEnv("GT_LOG_LEVEL", "info", ["debug", "info", "warn", "error"] as const),
  httpPort: process.env.GT_HTTP_PORT,
});
