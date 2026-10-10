// Hero / social preview, 1280x640: wordmark, claim, live stat chips, and a
// motif of several sources converging onto one point on a measured baseline.
import { C, svgDoc, text, rect, line, textWidth, glowFilter } from "./theme.mjs";

export const HERO = { w: 1280, h: 640 };

// Row B sits in the gaps of row A, so every strand runs clear of the other pills.
const SOURCES = [
  ["llms.txt", "docs", "GitHub"],
  ["npm", "PyPI", "MDN", "OWASP"],
];
const PILL_W = 84;
const PITCH = 104;

export function heroSvg(stats) {
  const { w, h } = HERO;
  const mx = 88;
  const dy = 22;
  const top = 76 + dy;
  const groundY = 412 + dy;
  const P = { x: 990, y: groundY };
  const parts = [];

  // Measured baseline: the "ground" every answer is checked against.
  parts.push(line(mx, groundY + 0.5, w - mx, groundY + 0.5, C.line2));
  for (let x = mx, i = 0; x <= w - mx; x += 16, i++) {
    const major = i % 5 === 0;
    parts.push(line(x + 0.5, groundY + 1, x + 0.5, groundY + (major ? 11 : 5), major ? C.line2 : C.line));
  }

  // Sources fan in from above and meet at P.
  const pills = [];
  const strands = [];
  SOURCES.forEach((row, r) => {
    const y = top + r * 58;
    row.forEach((label, i) => {
      const cx = P.x + (i - (row.length - 1) / 2) * PITCH;
      pills.push(rect(cx - PILL_W / 2, y, PILL_W, 32, { r: 16, fill: C.card, stroke: C.line2 }));
      pills.push(text(cx, y + 21, label, { size: 14, mono: true, fill: C.text2, anchor: "middle" }));
      const y0 = y + 32;
      strands.push(
        `<path d="M${cx},${y0} C${cx},${y0 + (P.y - y0) * 0.55} ${P.x},${P.y - (P.y - y0) * 0.5} ${P.x},${P.y - 9}" fill="none" stroke="url(#strand)" stroke-width="1.25"/>`,
      );
    });
  });
  parts.push(...strands, ...pills);

  // The one glow: the verified answer on the baseline.
  parts.push(`<circle cx="${P.x}" cy="${P.y}" r="15" fill="none" stroke="${C.teal}" stroke-opacity="0.3"/>`);
  parts.push(`<circle cx="${P.x}" cy="${P.y}" r="6" fill="${C.teal}" filter="url(#glow)"/>`);
  parts.push(text(P.x, P.y + 40, "verified answer", { size: 15, mono: true, fill: C.teal, anchor: "middle" }));

  // Copy.
  parts.push(`<circle cx="${mx + 4}" cy="${121 + dy}" r="4" fill="${C.teal}"/>`);
  parts.push(text(mx + 18, 127 + dy, "MCP server  /  @groundtruth-mcp/gt-mcp", { size: 16, mono: true, fill: C.text2 }));
  parts.push(text(mx - 5, 236 + dy, "GroundTruth", { size: 108, weight: 700, ls: -3 }));
  parts.push(text(mx, 296 + dy, "Live, official documentation and code audits", { size: 30, weight: 500, fill: C.text }));
  parts.push(text(mx, 336 + dy, "for AI coding agents.", { size: 30, weight: 500, fill: C.text2 }));

  // Stat chips, every number read from source.
  const chips = [
    [String(stats.libraries), "libraries"],
    [String(stats.toolCount), "MCP tools"],
    [String(stats.auditPatterns), "audit rules"],
    [String(stats.ecosystems.length), "ecosystems"],
  ];
  let cx = mx;
  const chipY = 468 + dy;
  for (const [num, label] of chips) {
    const cw = Math.round(textWidth(num, 21, { weight: 700 }) + 8 + textWidth(label, 18) + 44);
    parts.push(rect(cx, chipY, cw, 52, { r: 12, fill: C.card, stroke: C.line2 }));
    parts.push(
      text(cx + cw / 2, chipY + 33, [[num, { weight: 700, fill: C.text, size: 21 }], ["  " + label, { fill: C.text2, size: 18 }]], {
        anchor: "middle",
      }),
    );
    cx += cw + 12;
  }

  const defs = `${glowFilter("glow", 7, 0.9)}
<linearGradient id="strand" gradientUnits="userSpaceOnUse" x1="0" y1="${top + 30}" x2="0" y2="${P.y}">
<stop offset="0" stop-color="${C.line2}"/><stop offset="0.6" stop-color="${C.teal}" stop-opacity="0.28"/><stop offset="1" stop-color="${C.teal}" stop-opacity="0.85"/>
</linearGradient>
<radialGradient id="halo" cx="${P.x}" cy="${P.y}" r="320" gradientUnits="userSpaceOnUse">
<stop offset="0" stop-color="${C.teal}" stop-opacity="0.07"/><stop offset="1" stop-color="${C.teal}" stop-opacity="0"/>
</radialGradient>`;

  return svgDoc({
    w,
    h,
    id: "hero",
    title: "GroundTruth: live, official documentation and code audits for AI coding agents",
    desc: `GroundTruth MCP server (@groundtruth-mcp/gt-mcp). ${stats.libraries} libraries, ${stats.toolCount} MCP tools, ${stats.auditPatterns} audit rules, ${stats.ecosystems.length} ecosystems. Sources such as llms.txt, official docs, GitHub, npm, PyPI and OWASP converge on one verified answer.`,
    defs,
    body: `<rect width="${w}" height="${h}" fill="url(#halo)"/>\n${parts.join("\n")}`,
  });
}
