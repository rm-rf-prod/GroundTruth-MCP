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
    // Anchored on a real name boundary — an unanchored search matched
    // substrings of unrelated packages (eslint-plugin-react vs react).
    const re = new RegExp(`(?:^|["',])\\s*/?${escaped}[@/]([\\d.]+)`, "m");
    const match = raw.match(re);
    if (match?.[1]) return match[1];
  } catch { /* not found */ }

  try {
    const raw = await readFile(join(projectPath, "yarn.lock"), "utf-8");
    const escaped = escapeRegex(packageName);
    // Same boundary anchoring as pnpm above (super-react@1 must not answer
    // a lookup for react).
    const re = new RegExp(`(?:^|["',])\\s*${escaped}@[^"]*"?[\\s\\S]*?\\n\\s+version\\s+"([^"]+)"`, "m");
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

async function readLockfileIfExists(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf-8");
  } catch {
    return null;
  }
}

export async function detectAllVersions(
  projectPath: string,
  packageNames: string[],
): Promise<Map<string, string>> {
  const versions = new Map<string, string>();
  if (packageNames.length === 0) return versions;

  // Single-pass parallel read: avoids redundant disk reads for N packages
  const [packageLockRaw, pnpmLock, yarnLock, cargoLock, poetryLock, uvLock, goSum] = await Promise.all([
    readLockfileIfExists(join(projectPath, "package-lock.json")),
    readLockfileIfExists(join(projectPath, "pnpm-lock.yaml")),
    readLockfileIfExists(join(projectPath, "yarn.lock")),
    readLockfileIfExists(join(projectPath, "Cargo.lock")),
    readLockfileIfExists(join(projectPath, "poetry.lock")),
    readLockfileIfExists(join(projectPath, "uv.lock")),
    readLockfileIfExists(join(projectPath, "go.sum")),
  ]);

  let packageLockJson: {
    packages?: Record<string, { version?: string }>;
    dependencies?: Record<string, { version?: string }>;
  } | undefined;

  if (packageLockRaw) {
    try {
      packageLockJson = JSON.parse(packageLockRaw);
    } catch { /* malformed */ }
  }

  for (const name of packageNames) {
    let v: string | null = null;

    if (packageLockJson) {
      const pkgKey = `node_modules/${name}`;
      v = packageLockJson.packages?.[pkgKey]?.version ?? packageLockJson.dependencies?.[name]?.version ?? null;
    }

    if (!v && pnpmLock) {
      const escaped = escapeRegex(name);
      const re = new RegExp(`(?:^|["',])\\s*/?${escaped}[@/]([\\d.]+)`, "m");
      v = pnpmLock.match(re)?.[1] ?? null;
    }

    if (!v && yarnLock) {
      const escaped = escapeRegex(name);
      const re = new RegExp(`(?:^|["',])\\s*${escaped}@[^"]*"?[\\s\\S]*?\\n\\s+version\\s+"([^"]+)"`, "m");
      v = yarnLock.match(re)?.[1] ?? null;
    }

    if (!v && cargoLock) {
      const escaped = escapeRegex(name);
      const re = new RegExp(`\\[\\[package\\]\\]\\nname = "${escaped}"\\nversion = "([^"]+)"`, "m");
      v = cargoLock.match(re)?.[1] ?? null;
    }

    if (!v && poetryLock) {
      const escaped = escapeRegex(name);
      const re = new RegExp(`\\[\\[package\\]\\]\\nname = "${escaped}"\\nversion = "([^"]+)"`, "m");
      v = poetryLock.match(re)?.[1] ?? null;
    }

    if (!v && uvLock) {
      const escaped = escapeRegex(name);
      const re = new RegExp(`\\[\\[package\\]\\]\\nname = "${escaped}"\\nversion = "([^"]+)"`, "m");
      v = uvLock.match(re)?.[1] ?? null;
    }

    if (!v && goSum) {
      const escaped = escapeRegex(name);
      const re = new RegExp(`^${escaped}\\s+v([\\d.a-zA-Z-]+)`, "m");
      v = goSum.match(re)?.[1] ?? null;
    }

    if (v) {
      versions.set(name, v);
    }
  }

  return versions;
}
