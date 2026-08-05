/** Dependency-name extraction for JavaScript-family and dynamic-language manifests. */

export function parsePackageJson(content: string): string[] {
  try {
    const pkg = JSON.parse(content) as {
      dependencies?: Record<string, unknown>;
      devDependencies?: Record<string, unknown>;
    };
    return [...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})];
  } catch {
    return []; // malformed package.json
  }
}

export function parseComposerJson(content: string): string[] {
  try {
    const composer = JSON.parse(content) as {
      require?: Record<string, unknown>;
      "require-dev"?: Record<string, unknown>;
    };
    return [...Object.keys(composer.require ?? {}), ...Object.keys(composer["require-dev"] ?? {})]
      .filter((p) => p !== "php" && !p.startsWith("php-") && !p.startsWith("ext-"))
      // Strip vendor prefix: vendor/package -> package
      .map((p) => p.split("/").at(-1) ?? p);
  } catch {
    return []; // malformed composer.json
  }
}

export function parseDenoJson(content: string): string[] {
  try {
    const parsed = JSON.parse(content.replace(/\/\/[^\n]*/g, "")) as { imports?: Record<string, string> };
    return Object.keys(parsed.imports ?? {})
      .map((k) => k.replace(/^npm:/, "").split("@")[0] ?? k)
      .filter((k) => k.length > 0);
  } catch {
    return []; // malformed
  }
}

export function parseGemfile(content: string): string[] {
  const deps: string[] = [];
  for (const line of content.split("\n")) {
    const match = line.trim().match(/^gem\s+['"]([^'"]+)['"]/);
    if (match?.[1]) deps.push(match[1]);
  }
  return deps;
}
