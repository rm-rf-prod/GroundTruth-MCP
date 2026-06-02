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
    // Collapse CR/LF so untrusted strings (fetched URLs, error messages) cannot
    // forge extra log lines (log injection) in the line-oriented text format.
    const oneLine = (s: string): string => s.replace(/[\r\n]+/g, " ");
    const parts = [`[${entry.level}] ${oneLine(entry.msg)}`];
    if (entry.tool) parts.push(`tool=${oneLine(String(entry.tool))}`);
    if (entry.requestId) parts.push(`req=${oneLine(String(entry.requestId))}`);
    if (entry.durationMs !== undefined) parts.push(`${entry.durationMs}ms`);
    if (entry.cacheHit !== undefined) parts.push(entry.cacheHit ? "cache=hit" : "cache=miss");
    // Render remaining structured fields (url, error, domain, status, ...) so the
    // default text format keeps the debug context JSON mode already carries.
    const KNOWN = new Set(["level", "msg", "tool", "requestId", "durationMs", "cacheHit"]);
    for (const key of Object.keys(entry)) {
      if (KNOWN.has(key)) continue;
      const v = entry[key];
      if (v === undefined) continue;
      parts.push(`${key}=${oneLine(typeof v === "string" ? v : JSON.stringify(v))}`);
    }
    console.error(parts.join(" "));
  }
}
