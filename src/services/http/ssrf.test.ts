import { describe, it, expect } from "vitest";
import { isBlockedIP } from "./ssrf.js";

describe("isBlockedIP — reserved ranges and IPv4-embedding IPv6 forms (ENT-03)", () => {
  it.each([
    "198.18.0.1", // 198.18.0.0/15 benchmarking
    "198.19.255.255",
    "192.0.0.1", // 192.0.0.0/24 IETF protocol assignments
    "240.0.0.1", // 240.0.0.0/4 reserved
    "255.255.255.255", // limited broadcast
    "100.100.100.200", // Alibaba metadata (CGNAT range)
  ])("blocks reserved IPv4 %s", (ip) => {
    expect(isBlockedIP(ip)).toBe(true);
  });

  it.each([
    "64:ff9b::a9fe:a9fe", // NAT64 of 169.254.169.254
    "64:ff9b::7f00:1", // NAT64 of 127.0.0.1
    "::a9fe:a9fe", // IPv4-compatible 169.254.169.254
    "::a00:1", // IPv4-compatible 10.0.0.1
    "2002:a9fe:a9fe::1", // 6to4 of 169.254.169.254
    "2002:c0a8:101::", // 6to4 of 192.168.1.1
    "fd00:ec2::254", // AWS IMDS IPv6
  ])("blocks IPv6 %s that reaches a private IPv4 or ULA", (ip) => {
    expect(isBlockedIP(ip)).toBe(true);
  });

  it.each([
    "198.20.0.1",
    "192.0.1.1",
    "93.184.215.14",
    "64:ff9b::808:808", // NAT64 of public 8.8.8.8
    "2002:808:808::1", // 6to4 of public 8.8.8.8
    "2606:4700:4700::1111",
  ])("allows public address %s", (ip) => {
    expect(isBlockedIP(ip)).toBe(false);
  });
});
