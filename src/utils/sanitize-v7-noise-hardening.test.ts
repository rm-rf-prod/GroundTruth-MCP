import { describe, it, expect } from "vitest";
import { sanitizeContent } from "./sanitize.js";

describe("sanitizeContent", () => {
  describe("v7 noise hardening", () => {
    it("normalises CRLF line endings before the blank-line collapse (FIX-1)", () => {
      const out = sanitizeContent("alpha\r\n\r\n\r\n\r\nbravo");
      expect(out).not.toContain("\r");
      expect(out).not.toMatch(/\n{4,}/);
      expect(out).toContain("alpha");
      expect(out).toContain("bravo");
    });

    it("decodes residual symbol entities on the markdown path (FIX-2)", () => {
      const out = sanitizeContent("## Heading\n\nFoo &rarr; bar &times; 2, &copy; ACME, pilcrow &para; end.");
      expect(out).not.toMatch(/&(rarr|times|copy|para);/);
      expect(out).toContain(String.fromCharCode(0x2192)); // arrow
      expect(out).toContain(String.fromCharCode(0x00d7)); // times
      expect(out).toContain(String.fromCharCode(0x00a9)); // copyright
      expect(out).toContain(String.fromCharCode(0x00b6)); // pilcrow
    });

    it("decodes decimal and hex numeric entities (FIX-2)", () => {
      const out = sanitizeContent("Copyright &#169; and &#xA9; 2026.");
      expect(out).not.toMatch(/&#(169|xA9);/i);
      const copies = [...out].filter((c) => c.charCodeAt(0) === 0x00a9).length;
      expect(copies).toBe(2);
    });

    it("strips Cloudflare cdn-cgi email-protection placeholders (FIX-3)", () => {
      const out = sanitizeContent("Contact [[email protected]](/cdn-cgi/l/email-protection) for support.");
      expect(out).not.toContain("cdn-cgi");
      expect(out).not.toMatch(/\[email\s*protected\]/i);
      expect(out).toContain("Contact");
      expect(out).toContain("for support.");
    });

    it("strips classic/versioned-docs navigation chrome (FIX-4)", () => {
      const versionBar =
        "[Current](/docs/current/x.html) ([18](/docs/18/x.html)) / [17](/docs/17/x.html) / [16](/docs/16/x.html)";
      const out = sanitizeContent(
        `Real documentation paragraph that should survive.\n${versionBar}\nPrev Up Home Next\n16 | 15 | 14\nMore real content here.`,
      );
      expect(out).not.toContain("/docs/18/x.html");
      expect(out).not.toMatch(/^Prev Up Home Next$/m);
      expect(out).not.toMatch(/^16 \| 15 \| 14$/m);
      expect(out).toContain("Real documentation paragraph");
      expect(out).toContain("More real content here.");
    });

    it("strips orphan HTML comment markers (FIX-8)", () => {
      const out = sanitizeContent("Good content.\n-->\nMore content.");
      expect(out).not.toMatch(/^\s*-->\s*$/m);
      expect(out).toContain("Good content.");
      expect(out).toContain("More content.");
    });

    it("strips event/conference nav headings without eating real sections (FIX-8)", () => {
      const out = sanitizeContent(
        "## Upcoming OWASP Global Events\n\n## Real Section\n\nReal body text that must survive.",
      );
      expect(out).not.toContain("Upcoming OWASP Global Events");
      expect(out).toContain("Real Section");
      expect(out).toContain("Real body text that must survive.");
    });

    it("keeps real documentation content intact through the full chain (no over-strip)", () => {
      const doc = "# Guide\n\nUse `const x = 1` and call fetch(). Costs €5 at 50°C. Café ready.";
      const out = sanitizeContent(doc);
      expect(out).toContain("const x = 1");
      expect(out).toContain("fetch()");
      expect(out).toContain("€5");
      expect(out).toContain("Café");
    });
  });
});
