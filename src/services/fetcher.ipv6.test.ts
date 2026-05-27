import { describe, it, expect } from "vitest";
import { isBlockedIP } from "./fetcher.js";

describe("isBlockedIP — IPv6 full-form and edge cases", () => {
  it("blocks IPv6 shorthand loopback ::1", () => {
    expect(isBlockedIP("::1")).toBe(true);
  });

  it("blocks IPv6 full-form loopback 0000:...:0001", () => {
    expect(isBlockedIP("0000:0000:0000:0000:0000:0000:0000:0001")).toBe(true);
  });

  it("blocks IPv6 unspecified ::", () => {
    expect(isBlockedIP("::")).toBe(true);
  });

  it("blocks ULA fc00::/7", () => {
    expect(isBlockedIP("fc00::1")).toBe(true);
    expect(isBlockedIP("fd00::1")).toBe(true);
    expect(isBlockedIP("fdde:ad00::1")).toBe(true);
  });

  it("blocks link-local fe80::/10", () => {
    expect(isBlockedIP("fe80::1")).toBe(true);
    expect(isBlockedIP("fe80::abcd")).toBe(true);
  });

  it("blocks multicast ff00::/8", () => {
    expect(isBlockedIP("ff00::1")).toBe(true);
    expect(isBlockedIP("ff02::1")).toBe(true);
  });

  it("blocks IPv4-mapped to private (::ffff:127.0.0.1)", () => {
    expect(isBlockedIP("::ffff:127.0.0.1")).toBe(true);
  });

  it("blocks IPv4-mapped to RFC1918 (::ffff:10.0.0.1)", () => {
    expect(isBlockedIP("::ffff:10.0.0.1")).toBe(true);
  });

  it("allows public IPv6 addresses", () => {
    expect(isBlockedIP("2606:4700:4700::1111")).toBe(false); // cloudflare DNS
    expect(isBlockedIP("2001:4860:4860::8888")).toBe(false); // google DNS
  });

  it("blocks IPv4 loopback", () => {
    expect(isBlockedIP("127.0.0.1")).toBe(true);
    expect(isBlockedIP("127.1.2.3")).toBe(true);
  });

  it("blocks IPv4 link-local AWS metadata 169.254.169.254", () => {
    expect(isBlockedIP("169.254.169.254")).toBe(true);
  });

  it("blocks IPv4 RFC1918 private ranges", () => {
    expect(isBlockedIP("10.0.0.1")).toBe(true);
    expect(isBlockedIP("172.16.0.1")).toBe(true);
    expect(isBlockedIP("172.31.255.254")).toBe(true);
    expect(isBlockedIP("192.168.1.1")).toBe(true);
  });

  it("allows public IPv4 addresses", () => {
    expect(isBlockedIP("8.8.8.8")).toBe(false);
    expect(isBlockedIP("1.1.1.1")).toBe(false);
    expect(isBlockedIP("172.32.0.1")).toBe(false); // just outside 172.16/12
  });

  it("returns true for non-IP strings (refuse-by-default)", () => {
    expect(isBlockedIP("not an ip")).toBe(true);
    expect(isBlockedIP("")).toBe(true);
  });
});
