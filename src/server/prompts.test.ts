import { describe, it, expect } from "vitest";
import type { McpServer } from "@modelcontextprotocol/server";
import type { z } from "zod";
import { registerPrompts } from "./prompts.js";

type PromptConfig = { argsSchema?: z.ZodObject };
type PromptCallback = (args: Record<string, string>) => { messages: Array<{ content: { text: string } }> };

const prompts = new Map<string, { config: PromptConfig; cb: PromptCallback }>();
registerPrompts({
  registerPrompt(name: string, config: PromptConfig, cb: PromptCallback) {
    prompts.set(name, { config, cb });
  },
} as unknown as McpServer);

describe("migration-guide prompt", () => {
  const prompt = prompts.get("migration-guide")!;

  it("routes to gt_migration, the tool built for upgrade guides", () => {
    const text = prompt.cb({ library: "nextjs", fromVersion: "15", toVersion: "16" }).messages[0]!.content.text;
    expect(text).toContain("gt_migration");
    expect(text).toContain("from v15 to v16");
  });

  it("uses current version examples", () => {
    const shape = prompt.config.argsSchema!.shape as Record<string, z.ZodType>;
    expect(shape["fromVersion"]!.description).toContain("'15'");
    expect(shape["toVersion"]!.description).toContain("'16'");
  });
});
