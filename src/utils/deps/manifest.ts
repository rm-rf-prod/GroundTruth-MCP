import { readFile } from "fs/promises";
import { join } from "path";
import { parsePackageJson, parseComposerJson, parseDenoJson, parseGemfile } from "./parsers-js.js";
import { parseRequirementsTxt, parsePyproject } from "./parsers-python.js";
import { parseCargoToml, parseGoMod, parsePomXml, parseGradle, parsePubspec } from "./parsers-native.js";

export interface DependencySource {
  file: string;
  dependencies: string[];
}

interface Manifest {
  file: string;
  parse: (content: string) => string[];
  /** Only the first manifest in a group that yields dependencies is reported. */
  group?: string;
}

const MANIFESTS: Manifest[] = [
  { file: "package.json", parse: parsePackageJson },
  { file: "requirements.txt", parse: parseRequirementsTxt },
  { file: "pyproject.toml", parse: parsePyproject },
  { file: "Cargo.toml", parse: parseCargoToml },
  { file: "go.mod", parse: parseGoMod },
  { file: "pom.xml", parse: parsePomXml },
  { file: "composer.json", parse: parseComposerJson },
  { file: "build.gradle", parse: parseGradle, group: "gradle" },
  { file: "build.gradle.kts", parse: parseGradle, group: "gradle" },
  { file: "Gemfile", parse: parseGemfile },
  { file: "deno.json", parse: parseDenoJson, group: "deno" },
  { file: "deno.jsonc", parse: parseDenoJson, group: "deno" },
  { file: "pubspec.yaml", parse: parsePubspec },
];

async function readFileIfExists(filePath: string): Promise<string | null> {
  try {
    return await readFile(filePath, "utf-8");
  } catch {
    return null;
  }
}

/**
 * Read every dependency manifest present in a project and return the package
 * names each declares. Unreadable or malformed files are skipped, never thrown.
 */
export async function detectDependencies(projectPath: string): Promise<DependencySource[]> {
  const sources: DependencySource[] = [];
  const satisfiedGroups = new Set<string>();

  for (const manifest of MANIFESTS) {
    if (manifest.group && satisfiedGroups.has(manifest.group)) continue;
    const content = await readFileIfExists(join(projectPath, manifest.file));
    if (!content) continue;
    const dependencies = manifest.parse(content);
    if (dependencies.length === 0) continue;
    sources.push({ file: manifest.file, dependencies });
    if (manifest.group) satisfiedGroups.add(manifest.group);
  }

  return sources;
}
