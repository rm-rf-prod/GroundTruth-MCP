import { isIPv4, isIPv6 } from "net";

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
      ((int & 0xffffff00) >>> 0) === 0xc0000000 || // 192.0.0.0/24 IETF protocol assignments
      ((int & 0xfffe0000) >>> 0) === 0xc6120000 || // 198.18.0.0/15 benchmarking
      ((int & 0xf0000000) >>> 0) === 0xe0000000 || // 224.0.0.0/4 multicast
      ((int & 0xf0000000) >>> 0) === 0xf0000000    // 240.0.0.0/4 reserved, incl. 255.255.255.255
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
        const v4 = (hi: number, lo: number) => `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
        // IPv4 carried inside IPv6 is routed to that IPv4 host — recheck it against the IPv4 rules:
        // mapped ::ffff:0:0/96, compatible ::/96, NAT64 64:ff9b::/96, 6to4 2002::/16.
        const isV4Compat = groups.slice(0, 6).every((g) => g === 0);
        const isNat64 = groups[0] === 0x64 && groups[1] === 0xff9b && groups.slice(2, 6).every((g) => g === 0);
        if (isV4Mapped || isV4Compat || isNat64) return isBlockedIP(v4(groups[6]!, groups[7]!));
        if (groups[0] === 0x2002) return isBlockedIP(v4(groups[1]!, groups[2]!));
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
