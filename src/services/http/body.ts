/** Reading, capping and discarding response bodies. */

/** Header lookup that tolerates the header-less Response stand-ins some callers pass. */
export function responseHeader(res: Response, name: string): string | null {
  return (res as { headers?: { get?: (k: string) => string | null } }).headers?.get?.(name) ?? null;
}

/**
 * Cap remote response bodies so a malicious or misconfigured upstream cannot
 * exhaust memory by streaming gigabytes before truncation. Returns null when the
 * body exceeds `max` (by declared Content-Length or by streamed byte count).
 */
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

export async function readBodyCapped(res: Response, max = MAX_RESPONSE_BYTES): Promise<string | null> {
  const declared = Number(responseHeader(res, "content-length"));
  if (Number.isFinite(declared) && declared > max) return null;
  const body = (res as { body?: ReadableStream<Uint8Array> | null }).body;
  if (!body || typeof body.getReader !== "function") {
    const text = await res.text();
    return text.length > max ? null : text;
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  // A stream failing mid-read (reset, timeout) throws: null must mean "over the
  // cap" only, since callers negative-cache it for a day.
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.length;
    if (total > max) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf-8");
}

/** Drop a response body nobody will read: until then its connection and fetchWithTimeout's timer stay alive. */
export function discardBody(res: Response): void {
  void Promise.resolve((res as { body?: { cancel?: () => unknown } | null }).body?.cancel?.()).catch(() => {});
}
