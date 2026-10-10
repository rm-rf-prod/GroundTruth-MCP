import { describe, it, expect } from "vitest";
import { assertPublicUrl } from "./guard.js";

// IP-literal URLs never reach the DNS-level guard (net.connect skips lookup for
// literals), so assertPublicUrl must apply the full isBlockedIP rule set (ENT-03).
describe("assertPublicUrl — IP-literal hosts", () => {
  it.each([
    "http://100.100.100.200/latest/meta-data/",
    "http://[fd00:ec2::254]/latest/meta-data/",
    "http://[64:ff9b::a9fe:a9fe]/",
    "http://[64:ff9b::169.254.169.254]/",
    "http://198.18.0.1/",
    "http://[::a9fe:a9fe]/",
    "http://[::169.254.169.254]/",
    "http://[2002:a9fe:a9fe::1]/",
    "http://240.0.0.1/",
    "http://0x7f.1/",
    "http://2130706433/",
  ])("blocks %s", (url) => {
    expect(() => assertPublicUrl(url)).toThrow("Private/internal URL not allowed");
  });

  it.each([
    "http://93.184.215.14/",
    "https://[2606:4700:4700::1111]/",
    "https://example.com/docs",
  ])("allows public %s", (url) => {
    expect(() => assertPublicUrl(url)).not.toThrow();
  });

  it("still blocks localhost and .local hostnames", () => {
    expect(() => assertPublicUrl("http://localhost:3000/")).toThrow();
    expect(() => assertPublicUrl("http://printer.local/")).toThrow();
  });
});
