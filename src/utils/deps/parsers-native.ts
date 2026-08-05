/** Dependency-name extraction for compiled-language and mobile manifests. */

export function parseCargoToml(content: string): string[] {
  const deps: string[] = [];
  const depsSection = content.match(/\[dependencies\]([\s\S]*?)(?:\n\[|$)/);
  if (depsSection?.[1]) {
    for (const line of depsSection[1].split("\n")) {
      const match = line.match(/^([a-zA-Z0-9_-]+)\s*=/);
      if (match?.[1]) deps.push(match[1]);
    }
  }
  return deps;
}

export function parseGoMod(content: string): string[] {
  const deps: string[] = [];
  const lastSegment = (path: string): string => path.split("/").at(-1) ?? path;

  const requireBlock = content.match(/require\s*\(([\s\S]*?)\)/);
  if (requireBlock?.[1]) {
    for (const line of requireBlock[1].split("\n")) {
      const match = line.trim().match(/^([^\s]+)/);
      // extract last path segment as identifier
      if (match?.[1] && match[1] !== "//") deps.push(lastSegment(match[1]));
    }
  }
  // Single-line form: `require github.com/pkg/errors v0.9.1` — emitted by
  // `go mod tidy` for indirect deps, outside the require(...) block. The
  // `[^\s(]` first-char guard skips the `require (` block opener.
  for (const m of content.matchAll(/^require\s+([^\s(]\S*)\s+\S+/gm)) {
    if (m[1]) deps.push(lastSegment(m[1]));
  }
  return [...new Set(deps)];
}

export function parsePomXml(content: string): string[] {
  const deps: string[] = [];
  // Match <artifactId> inside <dependency> blocks
  for (const block of content.matchAll(/<dependency>([\s\S]*?)<\/dependency>/g)) {
    const artifactMatch = block[1]?.match(/<artifactId>\s*([^<\s]+)\s*<\/artifactId>/);
    if (artifactMatch?.[1]) deps.push(artifactMatch[1]);
  }
  return deps;
}

export function parseGradle(content: string): string[] {
  const deps: string[] = [];
  // Match: implementation("group:artifact:version") and similar
  const matches = content.matchAll(
    /(?:implementation|api|compileOnly|runtimeOnly|testImplementation)\s*[\("']+([^:'"]+):([^:'"]+):/g,
  );
  for (const m of matches) {
    if (m[2]) deps.push(m[2]);
  }
  return deps;
}

export function parsePubspec(content: string): string[] {
  const deps: string[] = [];
  const depsSection = content.match(/^dependencies:\s*\n((?:[ \t]+.+\n)*)/m);
  if (depsSection?.[1]) {
    for (const line of depsSection[1].split("\n")) {
      const match = line.trim().match(/^([a-zA-Z0-9_]+):/);
      if (match?.[1] && match[1] !== "flutter" && match[1] !== "sdk") deps.push(match[1]);
    }
  }
  return deps;
}
