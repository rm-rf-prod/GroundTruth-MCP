export const SERVER_NAME = "gt-mcp-server";
export const SERVER_VERSION = "2.2.0";

// Known size of the full private registry (updated with each release that adds entries)
export const REGISTRY_BADGE_SIZE = 363;

export const CHARS_PER_TOKEN = 3.8;

// Disk cache directory for persistent cross-invocation caching
export const DISK_CACHE_DIR =
  process.env.GT_CACHE_DIR ??
  (process.env.HOME ? `${process.env.HOME}/.gt-mcp-cache` : "/tmp/.gt-mcp-cache");
export const DEFAULT_TOKEN_LIMIT = 8000;
export const MAX_TOKEN_LIMIT = 20000;
export const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
export const FETCH_TIMEOUT_MS = 15_000;

export const JINA_BASE_URL = "https://r.jina.ai";
export const NPM_REGISTRY_URL = "https://registry.npmjs.org";
export const PYPI_URL = "https://pypi.org/pypi";
export const GITHUB_API_URL = "https://api.github.com";
export const GITHUB_RAW_URL = "https://raw.githubusercontent.com";

// Prompt injection guard patterns — strip suspicious LLM instruction attempts from fetched content
export const INJECTION_PATTERNS: RegExp[] = [
  /ignore\s+(all\s+)?(previous|prior|above)\s+instructions?/gi,
  /you\s+(are|must|should|will|have\s+to)\s+now/gi,
  /\bSYSTEM\s*:/g,
  /\bASSISTANT\s*:/g,
  /\b(JAILBREAK|DAN|DO ANYTHING NOW)\b/gi,
  /<\s*(?:system|instructions?)\s*>/gi,
  /forget\s+(everything|all)\s+(you|your)/gi,
  /new\s+instructions?.*?:/gi,
  /override\s+(your\s+)?(previous\s+)?instructions?/gi,
];
