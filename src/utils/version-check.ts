import { SERVER_VERSION, NPM_REGISTRY_URL, FETCH_TIMEOUT_MS } from "../constants.js";

let cachedLatest: { version: string; checkedAt: number } | null = null;
const CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

export async function getLatestVersion(): Promise<string | null> {
  if (cachedLatest && Date.now() - cachedLatest.checkedAt < CHECK_INTERVAL_MS) {
    return cachedLatest.version;
  }
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.min(5_000, FETCH_TIMEOUT_MS));
    const res = await fetch(`${NPM_REGISTRY_URL}/@groundtruth-mcp/gt-mcp/latest`, {
      signal: controller.signal,
      redirect: "manual",
      headers: { Accept: "application/json" },
    });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const data = (await res.json()) as { version?: string };
    if (typeof data.version === "string" && /^\d+\.\d+\.\d+/.test(data.version)) {
      cachedLatest = { version: data.version, checkedAt: Date.now() };
      return data.version;
    }
  } catch {
    // network error — silently ignore
  }
  return null;
}

export function isNewerVersion(latest: string, current: string): boolean {
  const parse = (v: string) => v.replace(/^v/, "").split("-")[0]!.split(".").map(Number);
  const [lMaj = 0, lMin = 0, lPat = 0] = parse(latest);
  const [cMaj = 0, cMin = 0, cPat = 0] = parse(current);
  if (!Number.isFinite(lMaj) || !Number.isFinite(cMaj)) return false;
  if (lMaj !== cMaj) return lMaj > cMaj;
  if (lMin !== cMin) return lMin > cMin;
  return lPat > cPat;
}

export async function checkForUpdate(): Promise<string | null> {
  const latest = await getLatestVersion();
  if (!latest) return null;
  if (isNewerVersion(latest, SERVER_VERSION)) {
    return latest;
  }
  return null;
}

let pendingUpdateVersion: string | null = null;

export function setPendingUpdate(version: string): void {
  pendingUpdateVersion = version;
}

export function getUpdateNoticeForResponse(): string {
  if (!pendingUpdateVersion) return "";
  return `\n\n---\n> [UPDATE AVAILABLE] GroundTruth v${pendingUpdateVersion} is out (you have v${SERVER_VERSION}). Restart your MCP client to get the latest version automatically via npx.`;
}

export function formatUpdateNotice(latestVersion: string): string {
  return `[UPDATE AVAILABLE] GroundTruth v${latestVersion} is out (you have v${SERVER_VERSION}). Run: npx @groundtruth-mcp/gt-mcp@latest`;
}
