import { describe, it, expect, afterAll } from "vitest";
import { COMMANDS, META, findCommand, route } from "./commands.js";
import { openSession, type Session } from "./session.js";
import { TOOL_COUNT } from "../constants.js";

describe("COMMANDS table", () => {
  it("maps every tool exactly once", () => {
    const tools = COMMANDS.map((c) => c.tool);
    expect(new Set(tools).size).toBe(tools.length);
    expect(tools).toHaveLength(TOOL_COUNT);
  });

  it("keeps names, aliases and tool names unique across commands", () => {
    const words = COMMANDS.flatMap((c) => [c.name, c.tool, ...c.aliases]);
    expect(new Set(words).size).toBe(words.length);
    for (const w of words) expect(META.has(w)).toBe(false);
  });

  it("finds a command by name, alias and tool name", () => {
    expect(findCommand("bp")?.tool).toBe("gt_best_practices");
    expect(findCommand("ask")?.tool).toBe("gt_dispatch");
    expect(findCommand("gt_search")?.name).toBe("search");
    expect(findCommand("frobnicate")).toBeUndefined();
  });

  describe("against the live tool schemas", () => {
    let session: Session;
    afterAll(async () => session?.close());

    it("names only real input keys as positionals, rest-positional last", async () => {
      session = await openSession();
      expect(session.tools).toHaveLength(TOOL_COUNT);
      for (const cmd of COMMANDS) {
        const tool = session.tools.find((t) => t.name === cmd.tool);
        expect(tool, cmd.tool).toBeDefined();
        const props = Object.keys(tool?.inputSchema.properties ?? {});
        cmd.positionals.forEach((spec, i) => {
          expect(props, `${cmd.name} <${spec}>`).toContain(spec.replace(/^\.\.\./, ""));
          if (spec.startsWith("...")) expect(i).toBe(cmd.positionals.length - 1);
        });
      }
    });
  });
});

describe("route()", () => {
  it.each([
    [[], true, "server"],
    [[], false, "server"],
    [["--version"], true, "server"],
    [["--health"], false, "server"],
    [["-h"], true, "server"],
    [["search"], false, "cli"],
    [["gt_search"], false, "cli"],
    [["bp", "react"], false, "cli"],
    [["tools"], false, "cli"],
    [["call"], false, "cli"],
    [["help"], false, "cli"],
    [["frobnicate"], true, "cli"],
    [["frobnicate"], false, "server"],
  ] as const)("%j with tty=%s -> %s", (args, tty, expected) => {
    expect(route(args, tty)).toBe(expected);
  });
});
