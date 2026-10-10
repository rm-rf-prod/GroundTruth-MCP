/**
 * Installs the SSRF-guarding DNS lookup on the global undici dispatcher. Loaded
 * lazily by fetchWithTimeout (undici's index is ~100 modules), which awaits it
 * before its first request; any other global fetch() caller must do the same.
 */
import dns from "dns";
import type { LookupAddress } from "dns";
import { Agent, setGlobalDispatcher } from "undici";
import { isBlockedIP } from "./ssrf.js";

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
  // Tool calls arrive seconds to minutes apart; undici's 4 s default dropped
  // every socket in between, so each call paid DNS + TLS again per host.
  keepAliveTimeout: 60_000,
  keepAliveMaxTimeout: 600_000,
  pipelining: 1,
  connections: 50,
}));
