import { readFile } from "fs/promises";
import { join } from "path";

export interface LockfileVersion {
  packageName: string;
  version: string;
  source: "package-lock" | "pnpm-lock" | "yarn-lock" | "cargo-lock" | "poetry-lock" | "uv-lock" | "go-mod";
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function detectVersionFromLockfile(
  projectPath: string,
  packageName: string,
): Promise<string | null> {
  try {
    const raw = await readFile(join(projectPath, "package-lock.json"), "utf-8");
    const lock = JSON.parse(raw) as {
      packages?: Record<string, { version?: string }>;
      dependencies?: Record<string, { version?: string }>;
    };
    const pkgKey = `node_modules/${packageName}`;
    const v = lock.packages?.[pkgKey]?.version ?? lock.dependencies?.[packageName]?.version;
    if (v) return v;
  } catch { /* not found */ }

  try {
    const raw = await readFile(join(projectPath, "pnpm-lock.yaml"), "utf-8");
    const escaped = escapeRegex(packageName);
    const re = new RegExp(`['"]?/?${escaped}[@/]([\\d.]+)`, "m");
    const match = raw.match(re);
    if (match?.[1]) return match[1];
  } catch { /* not found */ }

  try {
    const raw = await readFile(join(projectPath, "yarn.lock"), "utf-8");
    const escaped = escapeRegex(packageName);
    const re = new RegExp(`"?${escaped}@[^"]*"?[\\s\\S]*?\\n\\s+version\\s+"([^"]+)"`, "m");
    const match = raw.match(re);
    if (match?.[1]) return match[1];
  } catch { /* not found */ }

  try {
    const raw = await readFile(join(projectPath, "Cargo.lock"), "utf-8");
    const escaped = escapeRegex(packageName);
    const re = new RegExp(`\\[\\[package\\]\\]\\nname = "${escaped}"\\nversion = "([^"]+)"`, "m");
    const match = raw.match(re);
    if (match?.[1]) return match[1];
  } catch { /* not found */ }

  try {
    const raw = await readFile(join(projectPath, "poetry.lock"), "utf-8");
    const escaped = escapeRegex(packageName);
    const re = new RegExp(`\\[\\[package\\]\\]\\nname = "${escaped}"\\nversion = "([^"]+)"`, "m");
    const match = raw.match(re);
    if (match?.[1]) return match[1];
  } catch { /* not found */ }

  try {
    const raw = await readFile(join(projectPath, "uv.lock"), "utf-8");
    const escaped = escapeRegex(packageName);
    const re = new RegExp(`\\[\\[package\\]\\]\\nname = "${escaped}"\\nversion = "([^"]+)"`, "m");
    const match = raw.match(re);
    if (match?.[1]) return match[1];
  } catch { /* not found */ }

  try {
    const raw = await readFile(join(projectPath, "go.sum"), "utf-8");
    const escaped = escapeRegex(packageName);
    const re = new RegExp(`^${escaped}\\s+v([\\d.a-zA-Z-]+)`, "m");
    const match = raw.match(re);
    if (match?.[1]) return match[1];
  } catch { /* not found */ }

  return null;
}

export async function detectAllVersions(
  projectPath: string,
  packageNames: string[],
): Promise<Map<string, string>> {
  const versions = new Map<string, string>();
  // Detect all packages in parallel — auto-scan can request 20+ at once, and
  // each detection independently reads the same lockfiles.
  const entries = await Promise.all(
    packageNames.map(async (name) => [name, await detectVersionFromLockfile(projectPath, name)] as const),
  );
  for (const [name, v] of entries) {
    if (v) versions.set(name, v);
  }
  return versions;
}
