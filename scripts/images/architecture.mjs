// Request flow, 1600x900. Row 1 runs left to right out to the sources, row 2
// runs back right to left, and the answer returns to the client it came from.
import { C, svgDoc, text, rect, glowFilter } from "./theme.mjs";

export const ARCH = { w: 1600, h: 900 };

const ROW1 = 214;
const ROW2 = 610;
const LH = 33;
const HEAD = 52; // y offset of a card title baseline, also where the flow arrows attach

function card({ x, y, w, h, num, title, accent = false }) {
  const out = [rect(x, y, w, h, { r: 14, fill: C.card, stroke: accent ? C.teal : C.line2 })];
  if (num) out.push(text(x + 24, y + 30, num, { size: 16, mono: true, fill: C.muted }));
  out.push(text(x + 24, y + HEAD + 8, title, { size: 25, weight: 600 }));
  return out;
}

const body = (x, y, lines, o = {}) =>
  lines.map((l, i) => text(x, y + i * (o.lh ?? LH), l, { size: o.size ?? 21, fill: o.fill ?? C.text2, mono: o.mono }));

function arrow(x1, y1, x2, y2, color = C.gray, marker = "ah") {
  return `<path d="M${x1},${y1} L${x2},${y2}" stroke="${color}" stroke-width="1.5" fill="none" marker-end="url(#${marker})"/>`;
}

export function architectureSvg(stats) {
  const { w, h } = ARCH;
  const p = [];
  const gap = 36;
  const cols = [];
  let cx = 72;
  for (const cw of [216, 348, 232, 340, 172]) {
    cols.push({ x: cx, w: cw });
    cx += cw + gap;
  }
  const [cClient, cTools, cResolve, cFetch, cCache] = cols;

  p.push(text(72, 104, "How a request flows", { size: 36, weight: 600 }));
  p.push(
    text(72, 144, "Every answer is fetched from the official source at request time, then cleaned, ranked and checked.", {
      size: 21,
      fill: C.text2,
    }),
  );

  // Row 1: out to the sources.
  const clientH = 104 + 2 * LH + 30;
  p.push(...card({ ...cClient, y: ROW1, h: clientH, num: "01", title: "Client" }));
  p.push(...body(cClient.x + 24, ROW1 + 104, ["Any MCP agent", "stdio or HTTP", "gt-mcp CLI"]));

  const half = Math.ceil(stats.toolNames.length / 2);
  const toolsH = 104 + (half - 1) * LH + 30;
  p.push(...card({ ...cTools, y: ROW1, h: toolsH, num: "02", title: `${stats.toolCount} tools` }));
  p.push(text(cTools.x + cTools.w - 24, ROW1 + 30, "gt_*", { size: 16, mono: true, fill: C.muted, anchor: "end" }));
  const names = stats.toolNames.map((n) => n.replace(/^gt_/, ""));
  p.push(...body(cTools.x + 24, ROW1 + 104, names.slice(0, half), { mono: true, size: 17 }));
  p.push(...body(cTools.x + 24 + 166, ROW1 + 104, names.slice(half), { mono: true, size: 17 }));

  const resolveRows = [["Registry", String(stats.libraries)], ["npm"], ["PyPI"], ["crates.io"], ["Go modules"]];
  const resolveH = 104 + (resolveRows.length - 1) * 35 + 30;
  p.push(...card({ ...cResolve, y: ROW1, h: resolveH, num: "03", title: "Resolve" }));
  resolveRows.forEach(([label, value], i) => {
    const y = ROW1 + 104 + i * 35;
    p.push(text(cResolve.x + 24, y, label, { size: 21, fill: i === 0 ? C.text : C.text2 }));
    if (value) p.push(text(cResolve.x + cResolve.w - 24, y, value, { size: 18, mono: true, fill: C.teal, anchor: "end" }));
  });

  const steps = ["llms.txt", "Markdown negotiation", "HTML to Markdown", "GitHub docs", "Reader fallback"];
  const fetchH = 104 + (steps.length - 1) * 42 + 30;
  p.push(...card({ ...cFetch, y: ROW1, h: fetchH, num: "04", title: "Fetch chain" }));
  p.push(text(cFetch.x + cFetch.w - 24, ROW1 + 30, "first good hit wins", { size: 16, mono: true, fill: C.muted, anchor: "end" }));
  const railX = cFetch.x + 36;
  p.push(`<line x1="${railX}" y1="${ROW1 + 98}" x2="${railX}" y2="${ROW1 + 98 + (steps.length - 1) * 42}" stroke="${C.line2}"/>`);
  steps.forEach((s, i) => {
    const y = ROW1 + 104 + i * 42;
    p.push(`<circle cx="${railX}" cy="${y - 6}" r="11" fill="${C.card2}" stroke="${C.line2}"/>`);
    p.push(text(railX, y - 1, String(i + 1), { size: 13, mono: true, fill: C.text2, anchor: "middle" }));
    p.push(text(railX + 26, y, s, { size: 21, fill: C.text2 }));
  });

  // Cache sits beside the fetch chain: read before, written after.
  const cacheH = 104 + LH + 62;
  const cacheY = ROW1 + Math.round((fetchH - cacheH) / 2);
  p.push(...card({ ...cCache, y: cacheY, h: cacheH, title: "Cache" }));
  p.push(text(cCache.x + 24, cacheY + 30, "checked first", { size: 16, mono: true, fill: C.muted }));
  p.push(...body(cCache.x + 24, cacheY + 104, ["Memory LRU", "Disk"]));
  p.push(text(cCache.x + 24, cacheY + 104 + LH + 30, "~/.gt-mcp-cache", { size: 15, mono: true, fill: C.muted }));
  const cmY = cacheY + cacheH / 2;
  p.push(
    `<path d="M${cFetch.x + cFetch.w + 4},${cmY} H${cCache.x - 4}" stroke="${C.gray}" stroke-width="1.5" marker-start="url(#ahs)" marker-end="url(#ah)"/>`,
  );

  const a1 = ROW1 + HEAD;
  p.push(arrow(cClient.x + cClient.w + 4, a1, cTools.x - 6, a1));
  p.push(arrow(cTools.x + cTools.w + 4, a1, cResolve.x - 6, a1));
  p.push(arrow(cResolve.x + cResolve.w + 4, a1, cFetch.x - 6, a1));

  // Row 2: back toward the client.
  const fx = cFetch.x + cFetch.w / 2;
  p.push(arrow(fx, ROW1 + fetchH + 4, fx, ROW2 - 6));
  const row2H = clientH;
  const row2 = [
    [cFetch, "05", "Sanitize", ["Prompt-injection filter", "SSRF guard", "Boilerplate stripped"]],
    [cResolve, "06", "BM25 ranking", ["Scores sections", "for the topic", "Fits a token budget"]],
    [cTools, "07", "Evidence gate", ["Topic terms must appear", "in the source text,", "or it reports a miss"]],
  ];
  for (const [col, num, title, lines] of row2) {
    p.push(...card({ ...col, y: ROW2, h: row2H, num, title }));
    p.push(...body(col.x + 24, ROW2 + 104, lines));
  }
  p.push(rect(cClient.x, ROW2, cClient.w, row2H, { r: 14, fill: "none", stroke: C.teal, opacity: 0.6 }).replace("/>", ' filter="url(#glow)"/>'));
  p.push(...card({ ...cClient, y: ROW2, h: row2H, num: "08", title: "Answer", accent: true }));
  p.push(...body(cClient.x + 24, ROW2 + 104, ["Ranked excerpts", "Sources + date", "Topic coverage"]));

  const a2 = ROW2 + HEAD;
  p.push(arrow(cFetch.x - 4, a2, cResolve.x + cResolve.w + 6, a2));
  p.push(arrow(cResolve.x - 4, a2, cTools.x + cTools.w + 6, a2));
  p.push(arrow(cTools.x - 4, a2, cClient.x + cClient.w + 6, a2, C.teal, "aht"));

  // The verified answer goes back to the client: the one accent path and the one glow.
  const ax = cClient.x + 40;
  p.push(arrow(ax, ROW2 - 6, ax, ROW1 + clientH + 8, C.teal, "aht"));
  const midY = (ROW2 + ROW1 + clientH) / 2;
  p.push(text(ax + 18, midY - 4, "returned", { size: 17, mono: true, fill: C.teal }));
  p.push(text(ax + 18, midY + 20, "with sources", { size: 17, mono: true, fill: C.teal }));

  const mk = (id, color, start = false) =>
    `<marker id="${id}" viewBox="0 0 10 10" refX="${start ? 1 : 9}" refY="5" markerWidth="9" markerHeight="9" orient="auto${start ? "-start-reverse" : ""}"><path d="M0,1 L9,5 L0,9 Z" fill="${color}"/></marker>`;
  const defs = [mk("ah", C.gray), mk("ahs", C.gray, true), mk("aht", C.teal), glowFilter("glow", 6, 0.9)].join("\n");

  return svgDoc({
    w,
    h,
    id: "architecture",
    title: "GroundTruth request flow",
    desc:
      `01 Client (any MCP agent over stdio or HTTP, or the gt-mcp CLI) calls one of ${stats.toolCount} tools. ` +
      `03 Resolve maps the name through the registry of ${stats.libraries} libraries, npm, PyPI, crates.io or Go modules. ` +
      `04 Fetch chain tries ${steps.join(", ")}; the first good hit wins, with a memory LRU and disk cache beside it. ` +
      "05 Sanitize filters prompt injection, blocks SSRF and strips boilerplate. 06 BM25 ranks sections against the topic within a token budget. " +
      "07 Evidence gate requires the topic terms in the source text or reports an honest miss. 08 The answer returns to the client with ranked excerpts, sources, fetch date and topic coverage.",
    defs,
    body: p.join("\n"),
  });
}
