import { config } from "../config.js";

type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  level: LogLevel;
  msg: string;
  tool?: string;
  requestId?: string;
  durationMs?: number;
  cacheHit?: boolean;
  [key: string]: unknown;
}

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

function shouldLog(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[config.logLevel];
}

export function log(entry: LogEntry): void {
  if (!shouldLog(entry.level)) return;

  if (config.logFormat === "json") {
    const { level, msg, ...rest } = entry;
    console.error(JSON.stringify({ ts: new Date().toISOString(), level, msg, ...rest }));
  } else {
    const parts = [`[${entry.level}] ${entry.msg}`];
    if (entry.tool) parts.push(`tool=${entry.tool}`);
    if (entry.requestId) parts.push(`req=${entry.requestId}`);
    if (entry.durationMs !== undefined) parts.push(`${entry.durationMs}ms`);
    if (entry.cacheHit !== undefined) parts.push(entry.cacheHit ? "cache=hit" : "cache=miss");
    console.error(parts.join(" "));
  }
}
