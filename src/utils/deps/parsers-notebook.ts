import { lookupByAlias } from "../../sources/registry.js";

const INSTALL_LINE = /^\s*[%!]\s*(?:python3?\s+-m\s+)?(?:pip3?|conda|mamba)\s+install\s+(.+)$/;
/** Install flags that take a value in the next token: requirements file, channel, index, editable path. */
const VALUE_FLAG = /^(?:-[rcifenpt]|--(?:requirement|constraint|index-url|extra-index-url|find-links|channel|name|prefix|target|editable))$/;
const PACKAGE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** Package names from the arguments of one `pip|conda install` line, flags and version specifiers stripped. */
function installedPackages(args: string): string[] {
  const names: string[] = [];
  const tokens = args.replace(/#.*$/, "").split(/\s+/).filter(Boolean);
  for (let i = 0; i < tokens.length; i++) {
    const token = (tokens[i] ?? "").replace(/^["']|["']$/g, "");
    if (token.startsWith("-")) {
      if (VALUE_FLAG.test(token)) i++;
      continue;
    }
    // conda `channel::pkg`, extras `pkg[x]`, pins `pkg==1`, `pkg=1`, markers and `pkg @ url`
    const name = token.replace(/^.*::/, "").split(/[=<>!~[;@]/)[0] ?? "";
    if (PACKAGE_NAME.test(name)) names.push(name);
  }
  return names;
}

/** Top-level module names from `import a, b.c as d` and `from a.b import c` lines. */
function importedModules(line: string): string[] {
  const from = /^\s*from\s+([A-Za-z_]\w*)/.exec(line);
  if (from?.[1]) return [from[1]];
  const plain = /^\s*import\s+(.+)$/.exec(line);
  if (!plain?.[1]) return [];
  return plain[1].split(",").flatMap((part) => /^\s*([A-Za-z_]\w*)/.exec(part)?.[1] ?? []);
}

/**
 * Dependency names from the raw code-cell sources of one notebook: every
 * package on a `%pip|!pip|%conda install` line, plus imports the registry
 * knows by exact alias.
 *
 * Imports are filtered by `lookupByAlias`, not `matchDepToRegistry`: stdlib
 * names (os, re, json, sys, pathlib, typing, math) have no alias, while the
 * fuzzy fallback maps them to unrelated libraries (os -> androidx, re -> react,
 * json -> node-jsonwebtoken, math -> numpy). This also drops local modules.
 * shortcut: a third-party import without a registry alias (seaborn) is not
 * listed as unresolved; list it explicitly in a `%pip install` line or manifest.
 */
export function parseNotebookDependencies(cells: string[]): string[] {
  const deps = new Set<string>();
  for (const line of cells.flatMap((cell) => cell.split(/\r?\n/))) {
    const install = INSTALL_LINE.exec(line);
    if (install?.[1]) {
      for (const name of installedPackages(install[1])) deps.add(name);
      continue;
    }
    for (const module of importedModules(line)) {
      if (lookupByAlias(module)) deps.add(module);
    }
  }
  return [...deps];
}
