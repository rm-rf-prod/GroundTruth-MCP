/**
 * Cryptographic response watermarking for IP protection.
 *
 * Every registry response is embedded with an invisible fingerprint consisting of:
 *   - 32-bit installation ID  (persistent, unique per server instance)
 *   - 32-bit per-request nonce (random, makes each response distinct)
 *
 * Encoding uses two invisible Unicode mathematical operators:
 *   U+2061  FUNCTION APPLICATION  →  bit 0
 *   U+2062  INVISIBLE TIMES       →  bit 1
 *
 * These are in the "Invisible Operators" block (U+2061–U+2064), defined by
 * Unicode as semantically invisible in mathematical markup. They are:
 *   - Not rendered by any font
 *   - Preserved through copy-paste in virtually all text editors and platforms
 *   - Distinct from zero-width joiners (U+200C/D) flagged by AI detectors
 *   - Not stripped by common text sanitisers (they are not whitespace)
 *
 * If extracted content surfaces publicly, running detectWatermark() on it
 * returns the installation ID, providing forensic evidence of provenance.
 *
 * References:
 *   - Kirchenbauer et al. (2023): "A Watermark for Large Language Models"
 *   - Innamark (2025, arXiv:2502.12710): whitespace-replacement information hiding
 *   - NIST AI 100-4: covert watermarks for synthetic content provenance
 */

import { randomBytes, createHash } from "crypto";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join } from "path";
import { homedir } from "os";

// Invisible Unicode mathematical operators (not whitespace, not ZWJ/ZWS)
const BIT0 = "\u2061"; // FUNCTION APPLICATION
const BIT1 = "\u2062"; // INVISIBLE TIMES

// Persistent installation key file — created once per server instance
const INSTALL_KEY_FILE = join(homedir(), ".ws-mcp-install.key");

/**
 * Returns the 8-hex-char installation ID for this server instance.
 * Creates and persists a new one on first call.
 */
export function getInstallId(): string {
  if (existsSync(INSTALL_KEY_FILE)) {
    const raw = readFileSync(INSTALL_KEY_FILE, "utf-8").trim();
    // Validate stored ID is 8 lowercase hex chars
    if (/^[0-9a-f]{8}$/.test(raw)) return raw;
  }
  // Generate a new 4-byte (8 hex char) installation ID
  const id = randomBytes(4).toString("hex");
  try {
    writeFileSync(INSTALL_KEY_FILE, id + "\n", { mode: 0o600 });
  } catch {
    // Read-only fs or container environment — use the generated ID for this session only
  }
  return id;
}

/** Convert a 32-bit hex string (8 chars) to 32 invisible Unicode chars. */
function hexToInvisible(hex: string): string {
  // Parse as two 16-bit halves to avoid 32-bit integer overflow
  const hi = parseInt(hex.slice(0, 4), 16);
  const lo = parseInt(hex.slice(4, 8), 16);
  const bits =
    hi.toString(2).padStart(16, "0") +
    lo.toString(2).padStart(16, "0");
  return bits.split("").map(b => (b === "0" ? BIT0 : BIT1)).join("");
}

/** Extract invisible Unicode chars from text and decode back to hex. */
function invisibleToHex(text: string): string {
  const bits = [...text]
    .filter(c => c === BIT0 || c === BIT1)
    .map(c => (c === BIT0 ? "0" : "1"))
    .join("");
  if (bits.length < 32) return "";
  const hi = parseInt(bits.slice(0, 16), 2).toString(16).padStart(4, "0");
  const lo = parseInt(bits.slice(16, 32), 2).toString(16).padStart(4, "0");
  return hi + lo;
}

/**
 * Embed a 64-bit invisible watermark into text.
 *
 * Structure: [installId (32 bits)] + [nonce (32 bits)]
 * Inserted after the first newline character in the text.
 */
export function embedWatermark(text: string): string {
  const installId = getInstallId();
  const nonce = randomBytes(4).toString("hex");
  const invisible = hexToInvisible(installId) + hexToInvisible(nonce);

  // Insert after first newline — sits invisibly in the IP notice line
  const pos = text.indexOf("\n");
  if (pos === -1) return text + invisible;
  return text.slice(0, pos + 1) + invisible + text.slice(pos + 1);
}

/**
 * Extract and decode the watermark embedded in text.
 *
 * Returns:
 *   found     — whether a valid watermark was detected
 *   installId — 8-char hex ID of the server instance that produced this text
 *   nonce     — 8-char hex per-request nonce (proves distinct origin per response)
 *
 * Usage for forensic detection:
 *   import { detectWatermark } from "@senorit/ws-mcp/dist/utils/watermark.js";
 *   const result = detectWatermark(suspectedLeakedText);
 *   if (result.found) console.log("Originated from install:", result.installId);
 */
export function detectWatermark(text: string): {
  found: boolean;
  installId: string;
  nonce: string;
} {
  const bits = [...text]
    .filter(c => c === BIT0 || c === BIT1)
    .map(c => (c === BIT0 ? "0" : "1"))
    .join("");

  if (bits.length < 64) {
    return { found: false, installId: "", nonce: "" };
  }

  const idBits = bits.slice(0, 32);
  const nonceBits = bits.slice(32, 64);

  const idHi = parseInt(idBits.slice(0, 16), 2).toString(16).padStart(4, "0");
  const idLo = parseInt(idBits.slice(16, 32), 2).toString(16).padStart(4, "0");
  const nHi = parseInt(nonceBits.slice(0, 16), 2).toString(16).padStart(4, "0");
  const nLo = parseInt(nonceBits.slice(16, 32), 2).toString(16).padStart(4, "0");

  return {
    found: true,
    installId: idHi + idLo,
    nonce: nHi + nLo,
  };
}

/**
 * Returns a compact SHA-256-based integrity token for the response text
 * (excluding the embedded invisible chars). Not embedded in responses —
 * used for internal audit logging if desired.
 */
export function responseIntegrityToken(text: string): string {
  const clean = [...text].filter(c => c !== BIT0 && c !== BIT1).join("");
  return createHash("sha256").update(clean).digest("hex").slice(0, 16);
}
