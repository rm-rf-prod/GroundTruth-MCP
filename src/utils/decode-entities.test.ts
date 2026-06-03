import { describe, it, expect } from "vitest";
import {
  decodeHtmlEntities,
  decodeCfEmail,
  decodeCloudflareEmails,
  stripCloudflareEmailMarkdown,
} from "./decode-entities.js";

const SP = String.fromCharCode(32); // regular space, built explicitly to dodge stray NBSP
const NBSP = String.fromCharCode(0xa0);

/** Cloudflare obfuscation: XOR each byte with a per-render key stored in byte 0. */
function encodeCf(email: string, key: number): string {
  let hex = key.toString(16).padStart(2, "0");
  for (const ch of email) {
    hex += (ch.charCodeAt(0) ^ key).toString(16).padStart(2, "0");
  }
  return hex;
}

function hasControlChar(s: string): boolean {
  for (const ch of s) {
    const n = ch.charCodeAt(0);
    if (n <= 8 || (n >= 11 && n <= 31) || (n >= 127 && n <= 159)) return true;
  }
  return false;
}

describe("decodeHtmlEntities", () => {
  it("returns input unchanged when there are no entities (fast path)", () => {
    expect(decodeHtmlEntities("plain text, no entities")).toBe("plain text, no entities");
  });

  it("decodes the reserved five", () => {
    expect(decodeHtmlEntities("a &amp; b &lt;div&gt; &quot;q&quot; &#39;s&apos;")).toBe(
      "a & b <div> \"q\" 's'",
    );
  });

  it("decodes the residual symbol entities that defeated the old decoder", () => {
    expect(decodeHtmlEntities("Heading&para; arrow &rarr; copy &copy; em &mdash; dots &hellip;")).toBe(
      "Heading¶ arrow → copy © em — dots …",
    );
  });

  it("decodes decimal and hex numeric references", () => {
    expect(decodeHtmlEntities("&#169; &#xA9; &#8594; &#x2192;")).toBe("© © → →");
  });

  it("maps &nbsp; and numeric NBSP to a normal space (no U+00A0 left)", () => {
    const out = decodeHtmlEntities("a&nbsp;b&#160;c&#xA0;d");
    expect(out).toBe(["a", "b", "c", "d"].join(SP));
    expect(out.includes(NBSP)).toBe(false);
  });

  it("preserves unknown named entities verbatim (never corrupts)", () => {
    expect(decodeHtmlEntities("&notARealEntity; &fooBar;")).toBe("&notARealEntity; &fooBar;");
  });

  it("is idempotent on already-decoded text", () => {
    const once = decodeHtmlEntities("&lt;a&gt; &amp; &rarr;");
    expect(decodeHtmlEntities(once)).toBe(once);
  });

  it("drops control-char numeric refs instead of emitting raw control bytes", () => {
    const out = decodeHtmlEntities("a&#0;b&#7;c");
    expect(hasControlChar(out)).toBe(false);
    expect(out.replace(/\s/g, "")).toBe("abc");
  });

  it("preserves German umlauts decoded from entities", () => {
    expect(decodeHtmlEntities("Gr&ouml;&szlig;e &auml;ndern")).toBe("Größe ändern");
  });
});

describe("decodeCfEmail", () => {
  it("round-trips an XOR-encoded address", () => {
    const hex = encodeCf("kontakt@senorit.de", 0x2f);
    expect(decodeCfEmail(hex)).toBe("kontakt@senorit.de");
  });

  it("returns empty string on malformed hex", () => {
    expect(decodeCfEmail("")).toBe("");
    expect(decodeCfEmail("zz")).toBe("");
    expect(decodeCfEmail("abc")).toBe(""); // odd length
  });
});

describe("decodeCloudflareEmails (raw HTML)", () => {
  it("decodes the data-cfemail anchor form", () => {
    const hex = encodeCf("hi@example.com", 0x44);
    const html = `<p>Mail <a class="__cf_email__" data-cfemail="${hex}">[email&#160;protected]</a> us</p>`;
    const out = decodeCloudflareEmails(html);
    expect(out).toContain("hi@example.com");
    expect(out).not.toContain("__cf_email__");
  });

  it("decodes the href-fragment form", () => {
    const hex = encodeCf("dev@example.org", 0x10);
    const html = `<a href="/cdn-cgi/l/email-protection#${hex}">protected</a>`;
    expect(decodeCloudflareEmails(html)).toContain("dev@example.org");
  });

  it("leaves unrelated HTML untouched", () => {
    const html = "<p>No cloudflare here</p>";
    expect(decodeCloudflareEmails(html)).toBe(html);
  });
});

describe("stripCloudflareEmailMarkdown (Jina output)", () => {
  it("removes the no-hex placeholder link entirely (the live OWASP noise)", () => {
    const md = "Contact [[email protected]](/cdn-cgi/l/email-protection) for details.";
    const out = stripCloudflareEmailMarkdown(md);
    expect(out).not.toContain("cdn-cgi");
    expect(out).not.toMatch(/\[email\s*protected\]/i);
    expect(out).toContain("Contact");
    expect(out).toContain("for details.");
  });

  it("recovers the address when a #HEX fragment is present", () => {
    const hex = encodeCf("team@acme.io", 0x7b);
    const md = `Email [[email protected]](https://acme.io/cdn-cgi/l/email-protection#${hex}) now`;
    const out = stripCloudflareEmailMarkdown(md);
    expect(out).toContain("team@acme.io");
    expect(out).not.toContain("cdn-cgi");
  });

  it("leaves unrelated markdown untouched", () => {
    const md = "See [the docs](https://example.com/docs) here.";
    expect(stripCloudflareEmailMarkdown(md)).toBe(md);
  });
});
