import dns from "dns";
import type { LookupAddress } from "dns";
import { isIPv4, isIPv6 } from "net";
import { Agent, setGlobalDispatcher } from "undici";

export function isBlockedIP(address: string): boolean {
  if (isIPv4(address)) {
    // Destructure with a fail-closed guard — if the octets are ever malformed
    // (defense in depth beyond isIPv4) treat the address as blocked, not allowed.
    const [a, b, c, d] = address.split(".").map(Number);
    if (a === undefined || b === undefined || c === undefined || d === undefined) return true;
    const int = ((a << 24) | (b << 16) | (c << 8) | d) >>> 0;
    // All masks use >>> 0 to stay in unsigned 32-bit space (JS bitwise & returns signed)
    return (
      ((int & 0xff000000) >>> 0) === 0x7f000000 || // 127.0.0.0/8 loopback
      ((int & 0xff000000) >>> 0) === 0x00000000 || // 0.0.0.0/8 "this" network
      ((int & 0xff000000) >>> 0) === 0x0a000000 || // 10.0.0.0/8 private
      ((int & 0xfff00000) >>> 0) === 0xac100000 || // 172.16.0.0/12 private
      ((int & 0xffff0000) >>> 0) === 0xc0a80000 || // 192.168.0.0/16 private
      ((int & 0xffc00000) >>> 0) === 0x64400000 || // 100.64.0.0/10 CGNAT (RFC6598 — Alibaba metadata 100.100.100.200)
      ((int & 0xffff0000) >>> 0) === 0xa9fe0000 || // 169.254.0.0/16 link-local (cloud metadata)
      ((int & 0xf0000000) >>> 0) === 0xe0000000    // 224.0.0.0/4 multicast
    );
  }
  if (isIPv6(address)) {
    const lower = address.toLowerCase();
    // Quick wins on shorthand forms
    if (lower === "::1" || lower === "::") return true;
    if (lower.startsWith("fc") || lower.startsWith("fd")) return true;
    if (lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb")) return true;
    if (lower.startsWith("ff")) return true;
    if (lower.startsWith("::ffff:")) return true;

    // Defense against full-form bypass: 0000:...:0001 == ::1
    // Normalize by expanding "::" then checking each 8-group hextet
    // explicitly so 0000-padded forms cannot slip through.
    try {
      let expanded = lower;
      if (expanded.includes("::")) {
        const [head, tail] = expanded.split("::");
        const headGroups = head ? head.split(":") : [];
        const tailGroups = tail ? tail.split(":") : [];
        const missing = 8 - headGroups.length - tailGroups.length;
        if (missing >= 0) {
          expanded = [...headGroups, ...Array(missing).fill("0"), ...tailGroups].join(":");
        }
      }
      const groups = expanded.split(":").map((g) => parseInt(g || "0", 16));
      if (groups.length === 8 && groups.every((g) => Number.isInteger(g) && g >= 0 && g <= 0xffff)) {
        const isLoopback = groups.slice(0, 7).every((g) => g === 0) && groups[7] === 1;
        const isUnspecified = groups.every((g) => g === 0);
        // IPv4-mapped IPv6 (::ffff:a.b.c.d) — recheck against IPv4 rules
        const isV4Mapped = groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff;
        if (isLoopback || isUnspecified) return true;
        if (isV4Mapped) {
          const v4 = `${(groups[6]! >> 8) & 0xff}.${groups[6]! & 0xff}.${(groups[7]! >> 8) & 0xff}.${groups[7]! & 0xff}`;
          return isBlockedIP(v4);
        }
        // ULA fc00::/7 → first byte high bit pattern 1111110x
        if ((groups[0]! & 0xfe00) === 0xfc00) return true;
        // Link-local fe80::/10
        if ((groups[0]! & 0xffc0) === 0xfe80) return true;
        // Multicast ff00::/8
        if ((groups[0]! & 0xff00) === 0xff00) return true;
      }
    } catch {
      // If parsing fails on something unusual, refuse by default
      return true;
    }
    return false;
  }
  return true;
}

setGlobalDispatcher(new Agent({
  connect: {
    lookup(hostname, options, callback) {
      dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
        if (err) return callback(err, "", 4);
        // all:true always yields an array; the fallback branch is dead code kept only for exhaustive typing.
        const entries: LookupAddress[] = Array.isArray(addresses) ? addresses : [{ address: String(addresses), family: 4 }];
        const safe = entries.filter((entry) => !isBlockedIP(entry.address));
        if (safe.length === 0) {
          return callback(new Error(`SSRF blocked: ${hostname} resolves to private/blocked IP`), "", 4);
        }
        // Undici expects array format when options.all is true, single entry otherwise
        if (options.all) {
          // net.LookupFunction type omits the all-addresses overload; cast is required.
          return (callback as unknown as (err: null, addrs: LookupAddress[]) => void)(null, safe);
        }
        const first = safe[0]!;
        callback(null, first.address, first.family);
      });
    },
  },
  // Network-layer timeouts — defense in depth alongside fetchWithTimeout's AbortController
  headersTimeout: 15_000,
  bodyTimeout: 30_000,
  // Keep-alive tuning for parallel doc fetches
  keepAliveTimeout: 4_000,
  keepAliveMaxTimeout: 10_000,
  pipelining: 1,
  connections: 50,
}));
