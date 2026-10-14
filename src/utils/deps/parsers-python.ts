/** Dependency-name extraction for Python manifests. */

/** Strip version specifiers / extras from a PEP 508 requirement string. */
function requirementName(raw: string): string {
  const trimmed = raw.trim().replace(/^["']|["'],?$/g, "");
  return trimmed.split(/[>=<!~[\s]/)[0]?.trim() ?? "";
}

export function parseRequirementsTxt(content: string): string[] {
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#") && !line.startsWith("-"))
    .map((line) => line.split(/[=><!~\[]/)[0]?.trim() ?? "")
    .filter(Boolean);
}

/** Keys of a TOML table, skipping the implicit `python` entry Poetry adds. */
function tomlTableKeys(block: string): string[] {
  const deps: string[] = [];
  for (const line of block.split("\n")) {
    const match = line.match(/^([a-zA-Z0-9_-]+)\s*=/);
    if (match?.[1] && match[1] !== "python") deps.push(match[1]);
  }
  return deps;
}

/** Entries of a TOML array-of-requirements, skipping comments and inline tables. */
function tomlArrayNames(block: string): string[] {
  const deps: string[] = [];
  for (const line of block.split("\n")) {
    const name = requirementName(line);
    if (name.length > 0 && !name.startsWith("#") && !name.startsWith("{")) deps.push(name);
  }
  return deps;
}

export function parsePyproject(content: string): string[] {
  const deps: string[] = [];

  // [tool.poetry.dependencies] — Poetry format
  const poetryBlock = content.match(/\[tool\.poetry\.dependencies\]([\s\S]*?)(?:\[|$)/);
  if (poetryBlock?.[1]) deps.push(...tomlTableKeys(poetryBlock[1]));

  // [project.dependencies] — PEP 517 format (uv, hatch, rye, pdm)
  const pep517Block = content.match(/\[project\]([\s\S]*?)(?:\n\[(?!project\.)|$)/);
  if (pep517Block?.[1]) {
    const depsArray = pep517Block[1].match(/dependencies\s*=\s*\[([\s\S]*?)\]/);
    if (depsArray?.[1]) deps.push(...tomlArrayNames(depsArray[1]));
  }

  // [project.optional-dependencies.*] — extras/optional deps
  for (const block of content.matchAll(/\[project\.optional-dependencies\.[^\]]+\]([\s\S]*?)(?:\[|$)/g)) {
    if (block[1]) deps.push(...tomlArrayNames(block[1]));
  }

  // [tool.poetry.dev-dependencies] — Poetry dev-only deps (legacy section,
  // dropped silently before this; deduped by the caller).
  const poetryDevBlock = content.match(/\[tool\.poetry\.dev-dependencies\]([\s\S]*?)(?:\[|$)/);
  if (poetryDevBlock?.[1]) deps.push(...tomlTableKeys(poetryDevBlock[1]));

  // [dependency-groups] — PEP 735 (pip 24+, uv). Each group is an array; a
  // `{ include-group = "x" }` entry references another group and is skipped.
  const groupBlock = content.match(/\[dependency-groups\]([\s\S]*?)(?:\n\[|$)/);
  if (groupBlock?.[1]) {
    for (const arr of groupBlock[1].matchAll(/=\s*\[([\s\S]*?)\]/g)) {
      if (arr[1]) deps.push(...tomlArrayNames(arr[1]));
    }
  }

  return [...new Set(deps)];
}

export function parseCondaYaml(content: string): string[] {
  const deps: string[] = [];
  const lines = content.split("\n");
  let inDeps = false;

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    if (/^dependencies\s*:/.test(line)) {
      inDeps = true;
      continue;
    }

    // Another top-level key ends the dependencies section
    if (inDeps && /^[a-zA-Z0-9_-]+\s*:/.test(line) && !line.startsWith("-")) {
      inDeps = false;
      continue;
    }

    if (inDeps && line.startsWith("-")) {
      const item = line.slice(1).trim();
      if (!item || item.startsWith("pip:")) continue;
      // Strip conda channel prefix (e.g. "conda-forge::scipy=1.10" -> "scipy=1.10")
      const rawPkg = item.includes("::") ? (item.split("::").pop() ?? item) : item;
      // Extract package name before =, >, <, ~, [, etc.
      const name = rawPkg.split(/[=><~\[\s]/)[0]?.trim();
      if (name && name !== "python" && name !== "pip") {
        deps.push(name);
      }
    }
  }
  return [...new Set(deps)];
}

export function parsePipfile(content: string): string[] {
  const deps: string[] = [];
  const packagesBlock = content.match(/\[packages\]([\s\S]*?)(?:\n\s*\[|$)/);
  if (packagesBlock?.[1]) deps.push(...tomlTableKeys(packagesBlock[1]));

  const devPackagesBlock = content.match(/\[dev-packages\]([\s\S]*?)(?:\n\s*\[|$)/);
  if (devPackagesBlock?.[1]) deps.push(...tomlTableKeys(devPackagesBlock[1]));

  return [...new Set(deps)];
}
