#!/usr/bin/env node
// Bootstrap only. Static imports stay minimal so --version, --help and the
// routing decision never load the tool modules; everything else is imported
// on demand below.
import * as nodeModule from "node:module";
import { route } from "./cli/commands.js";

// Must run before the dynamic imports: modules linked earlier are not cached.
// Never throws by contract; the guard covers runtimes without the API.
try {
  nodeModule.enableCompileCache?.();
} catch { /* run uncached */ }
const flushCompileCache = (): void => {
  try {
    nodeModule.flushCompileCache?.();
  } catch { /* best effort */ }
};

const args = process.argv.slice(2);

if (route(args, process.stdin.isTTY === true) === "cli") {
  process.env["GT_LOG_LEVEL"] ??= "warn"; // config.js freezes on first import
  let code = 2;
  let out = "";
  try {
    const [{ runCli }, { pruneInBackground }] = await Promise.all([import("./cli/run.js"), import("./cli/flush.js")]);
    pruneInBackground();
    const result = await runCli(args);
    code = result.code;
    out = result.out;
    process.stderr.write(result.err);
  } catch (e) {
    // Only load-time failures land here, e.g. an invalid GT_* variable.
    process.stderr.write(`gt-mcp: ${e instanceof Error ? e.message : String(e)}\n`);
  }
  flushCompileCache();
  // Exit explicitly once stdout drains: tool code can leave long timers pending.
  process.stdout.write(out, () => process.exit(code));
} else {
  const { handleCliFlags } = await import("./server/cli.js");
  await handleCliFlags(args);
  await import("./server/main.js");
  // The server is long-lived and usually killed by a signal, so write now.
  flushCompileCache();
}
