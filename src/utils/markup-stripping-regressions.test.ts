import { describe, it, expect } from "vitest";
import { stripNoisyElements } from "./html/clean.js";
import { stripTags } from "./html/links.js";
import { convertTable } from "./html/table.js";
import { visibleTextLength } from "./html-to-md.js";
import { sanitizeContent } from "./sanitize.js";
import { decodeCloudflareEmails } from "./decode-entities.js";

describe("script and style end tags with extra characters", () => {
  it("strips </script >, </SCRIPT foo> and tab or newline variants", () => {
    for (const end of ["</script >", "</SCRIPT foo>", "</script\t\n bar>"]) {
      expect(stripNoisyElements(`<p>a</p><script>evil()${end}<p>b</p>`)).not.toContain("evil");
    }
    expect(stripNoisyElements("<style>x{}</style\n>ok")).toBe("ok");
    expect(stripNoisyElements("<noscript>n</noscript >ok")).toBe("ok");
  });

  it("sanitizeContent drops script and style closed with attributes", () => {
    const out = sanitizeContent("Intro text.\n<script>evil()</script >\n<style>.a{}</style x>\nOutro text.");
    expect(out).not.toMatch(/evil|<script|<style|\.a\{/);
    expect(out).toContain("Outro text.");
  });

  it("visibleTextLength ignores a script closed with </script\\t\\n bar>", () => {
    expect(visibleTextLength("<p>ab</p><script>xxxxxxxx</script\t\n bar>")).toBe(2);
  });
});

describe("nested tag fragments", () => {
  it("removes <scr<script>ipt> style rebuilds", () => {
    expect(stripNoisyElements("<scr<script></script>ipt>evil()</script>x")).not.toMatch(/<script/i);
    expect(stripTags("<p>a</p><br/>b")).toBe("ab");
    expect(sanitizeContent("<scr<script></script>ipt>alert(1)</script>after")).not.toMatch(/<script/i);
  });

  it("decodeCloudflareEmails leaves no loader script behind", () => {
    const html = '<i class="cf_email"></i><scr<script src="/cdn-cgi/scripts/x.js"></script>ipt src="/cdn-cgi/scripts/y.js"></script>ok';
    expect(decodeCloudflareEmails(html)).not.toMatch(/<script/i);
  });
});

describe("HTML comment markers", () => {
  it("strips an orphan --!> marker line", () => {
    const out = sanitizeContent("Good content.\n--!>\nMore content.");
    expect(out).not.toMatch(/--!?>/);
    expect(out).toContain("More content.");
  });

  it("strips multi-line comments and orphan openers", () => {
    const out = sanitizeContent("Before.\n<!-- a\nb\nc --!>\nAfter.\n<!-- dangling\nEnd.");
    expect(out).not.toContain("<!--");
    expect(out).toContain("Before.");
    expect(out).toContain("After.");
    expect(out).toContain("End.");
  });
});

describe("table cell escaping", () => {
  it("escapes a backslash before a pipe", () => {
    const out = convertTable("<tr><td>a\\|b</td><td>c\\d</td></tr>");
    expect(out).toContain("| a\\\\\\|b | c\\\\d |");
  });
});

describe("orphan comment markers", () => {
  it("keeps text after a balanced comment on the same line", () => {
    const out = sanitizeContent("<!-- anchor --> ## Heading\nKeep this text.\nmore\n<!-- end -->\nafter");
    expect(out).toContain("Keep this text.");
    expect(out).toContain("Heading");
  });
});
