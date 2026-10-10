import { describe, it, expect } from "vitest";
import { assemblePages } from "./deep-fetch-pages.js";

const fences = (s: string): number => (s.match(/^[ \t]*(?:```|~~~)/gm) ?? []).length;
const NAV = "This shared navigation paragraph appears on every page of the site and must appear once.";
const BODY = "function ChatRoom({ roomId }) {\n  const [serverUrl, setServerUrl] = useState('https://localhost:1234');";

describe("assemblePages — code fences", () => {
  it("never drops part of a code block, so fences stay balanced", () => {
    // The same code chunk repeats inside two samples; blank lines split each sample into paragraphs.
    const sample = (tail: string): string => `\`\`\`js\nimport { useState, useEffect } from 'react';\nimport { createConnection } from './chat.js';\n\n${BODY}\n\n  ${tail}\n}\n\`\`\``;
    const page = [NAV, sample("return <h1>One</h1>;"), "Some prose between the samples, long enough to hash.", sample("return <h1>Two</h1>;")].join("\n\n");
    const out = assemblePages([{ content: page, url: "https://react.dev/a" }]);
    expect(fences(out)).toBe(fences(page));
    expect(out).toContain("return <h1>Two</h1>;");
    expect(out.split(BODY).length - 1).toBe(2);
  });

  it("still drops a whole repeated code block and repeated prose", () => {
    const block = "```css\ninput { margin-bottom: 10px; }\nbutton { margin-left: 5px; }\n```";
    const out = assemblePages([
      { content: `${NAV}\n\n${block}`, url: "https://x.dev/a" },
      { content: `${NAV}\n\n${block}\n\nUnique closing paragraph for page b.`, url: "https://x.dev/b" },
    ]);
    expect(out.split(NAV).length - 1).toBe(1);
    expect(out.split(block).length - 1).toBe(1);
    expect(fences(out)).toBe(2);
  });
});
