/** Dev tooling and utility packages with no useful best-practices docs. */
export const SKIP_DEPS = new Set([
  // TypeScript
  "typescript", "ts-node", "tsx", "tsc-alias",
  // Type definitions
  "@types/node", "@types/react", "@types/react-dom", "@types/jest", "@types/lodash",
  "@types/express", "@types/cors", "@types/body-parser", "@types/uuid",
  // Linting / formatting
  "eslint", "prettier", "eslint-config-next", "eslint-config-prettier",
  "eslint-plugin-react", "eslint-plugin-react-hooks", "eslint-plugin-jsx-a11y",
  "@typescript-eslint/parser", "@typescript-eslint/eslint-plugin",
  // Testing runners
  "jest", "vitest", "@vitest/coverage-v8", "@vitest/ui",
  // Bundlers / build tools
  "webpack", "webpack-cli", "vite", "rollup", "esbuild", "parcel", "turbopack",
  "terser", "swc", "@swc/core", "@swc/cli",
  // Node utilities
  "cross-env", "dotenv", "nodemon", "concurrently", "rimraf", "copyfiles",
  "source-map-support", "tslib", "module-alias",
  // PostCSS / autoprefixer (config-only, no best-practices needed)
  "postcss", "autoprefixer", "cssnano",
  // Babel
  "babel-jest", "@babel/core", "@babel/preset-env", "@babel/preset-typescript",
  // Husky / lint-staged
  "husky", "lint-staged", "commitlint",
  // Misc utility
  "lodash", "lodash-es", "underscore",
  // Bun / Deno type stubs
  "@types/bun", "bun-types",
  // CLI color utilities
  "chalk", "kleur", "picocolors", "ansi-colors",
  // CLI argument parsers
  "commander", "yargs", "meow", "minimist",
  // Glob utilities
  "glob", "fast-glob", "globby",
  // Build tools
  "microbundle", "tsup", "unbuild", "ncc",
  // Path/OS utilities
  "path", "os", "fs", "stream", "buffer",
]);
