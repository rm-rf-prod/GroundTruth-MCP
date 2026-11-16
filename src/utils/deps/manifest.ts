import { readFile, readdir, stat } from "fs/promises";
import { join } from "path";
import { NOTEBOOK_MAX_BYTES, parseNotebook } from "../notebook.js";
import { parseNotebookDependencies } from "./parsers-notebook.js";
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

/** Bounds the reads when a project root is full of notebooks. */
const MAX_NOTEBOOKS = 20;

/** Dependencies of each Python notebook in the project root (`%pip install` lines and registry-known imports). */
async function notebookDependencies(projectPath: string): Promise<DependencySource[]> {
  let names: string[];
  try {
    names = (await readdir(projectPath, { withFileTypes: true }))
      .filter((e) => e.isFile() && e.name.endsWith(".ipynb"))
      .map((e) => e.name)
      .sort()
      .slice(0, MAX_NOTEBOOKS);
  } catch {
    return [];
  }
  const sources: DependencySource[] = [];
  for (const file of names) {
    try {
      const path = join(projectPath, file);
      if ((await stat(path)).size > NOTEBOOK_MAX_BYTES) continue;
      const cells = parseNotebook(await readFile(path, "utf-8"));
      const dependencies = cells ? parseNotebookDependencies(cells) : [];
      if (dependencies.length > 0) sources.push({ file, dependencies });
    } catch {
      // unreadable notebook: skip
    }
  }
  return sources;
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

  return [...sources, ...(await notebookDependencies(projectPath))];
}
