import { readFile } from "fs/promises";
import { join } from "path";

export interface LockfileVersion {
  packageName: string;
  version: string;
  source: "package-lock" | "pnpm-lock" | "yarn-lock" | "cargo-lock" | "poetry-lock";
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
    const escaped = packageName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`['"]?/?${escaped}[@/]([\\d.]+)`, "m");
    const match = raw.match(re);
    if (match?.[1]) return match[1];
  } catch { /* not found */ }

  try {
    const raw = await readFile(join(projectPath, "yarn.lock"), "utf-8");
    const escaped = packageName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`"?${escaped}@[^"]*"?[\\s\\S]*?\\n\\s+version\\s+"([^"]+)"`, "m");
    const match = raw.match(re);
    if (match?.[1]) return match[1];
  } catch { /* not found */ }

  try {
    const raw = await readFile(join(projectPath, "Cargo.lock"), "utf-8");
    const re = new RegExp(`\\[\\[package\\]\\]\\nname = "${packageName}"\\nversion = "([^"]+)"`, "m");
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
  for (const name of packageNames) {
    const v = await detectVersionFromLockfile(projectPath, name);
    if (v) versions.set(name, v);
  }
  return versions;
}
