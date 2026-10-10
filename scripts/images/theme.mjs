// Shared visual tokens and SVG string helpers for the README images.
// Text tokens are checked against every surface below at >= 4.5:1 (muted is the floor, ~4.9:1 on card2).

export const C = {
  bg: "#0a0d0c",
  card: "#111715",
  card2: "#161e1b",
  line: "#1f2925",
  line2: "#2b3833",
  text: "#f1f5f3",
  text2: "#a9b5b0",
  muted: "#808d88",
  teal: "#00d4aa",
  tealDeep: "#0d3a30",
  gray: "#66736e",
  // Chart marks, checked with the dataviz palette validator on bg: in the dark lightness band,
  // CVD separation 15.3. barMuted fails only the chroma floor, on purpose: it is the de-emphasis gray.
  bar: "#00ae8b",
  barMuted: "#5d6b66",
};

// Inter / SF / Segoe on most viewers; Ubuntu Sans and Ubuntu Sans Mono on this render host.
export const SANS = "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Ubuntu Sans', 'Helvetica Neue', Ubuntu, Arial, sans-serif";
export const MONO = "'JetBrains Mono', 'SF Mono', SFMono-Regular, Menlo, Consolas, 'Ubuntu Sans Mono', 'Ubuntu Mono', 'DejaVu Sans Mono', monospace";

export const esc = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

const attrs = (o) =>
  Object.entries(o)
    .filter(([, v]) => v !== undefined && v !== null && v !== false)
    .map(([k, v]) => `${k}="${esc(v)}"`)
    .join(" ");

/** One <text> element. `spans` lets a single line mix colors/weights: [[str, {fill, weight}], ...]. */
export function text(x, y, content, o = {}) {
  const { size = 16, weight = 400, fill = C.text, anchor = "start", mono = false, ls, opacity, cls } = o;
  const body = Array.isArray(content)
    ? content.map(([s, so = {}]) => `<tspan ${attrs({ fill: so.fill, "font-weight": so.weight, "font-size": so.size, class: so.mono ? "m" : undefined })}>${esc(s)}</tspan>`).join("")
    : esc(content);
  return `<text ${attrs({
    x, y, "font-size": size, "font-weight": weight === 400 ? undefined : weight, fill,
    "text-anchor": anchor === "start" ? undefined : anchor, "letter-spacing": ls, opacity,
    class: cls ?? (mono ? "m" : undefined),
  })}>${body}</text>`;
}

export function rect(x, y, w, h, o = {}) {
  const { r = 12, fill = C.card, stroke = C.line, sw = 1, opacity } = o;
  // Half-pixel offset keeps 1px strokes crisp on integer coordinates.
  const off = stroke && sw % 2 === 1 ? 0.5 : 0;
  return `<rect ${attrs({ x: x + off, y: y + off, width: w - 2 * off, height: h - 2 * off, rx: r, fill, stroke: stroke || undefined, "stroke-width": stroke ? sw : undefined, opacity })}/>`;
}

export const line = (x1, y1, x2, y2, stroke = C.line2, sw = 1, extra = {}) =>
  `<line ${attrs({ x1, y1, x2, y2, stroke, "stroke-width": sw, ...extra })}/>`;

/** Horizontal bar, square at the baseline, 4px rounded data-end. */
export function hbar(x, y, w, h, fill, r = 4) {
  const rr = Math.min(r, w / 2, h / 2);
  if (w <= 0) return "";
  return `<path d="M${x},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h - rr}Q${x + w},${y + h} ${x + w - rr},${y + h}H${x}Z" fill="${fill}"/>`;
}

/** Rough advance width, used only to size chips and place trailing labels; layouts leave slack for font variance. */
export function textWidth(str, size, { mono = false, weight = 400 } = {}) {
  if (mono) return str.length * size * 0.6;
  let em = 0;
  for (const ch of str) {
    if (/[ilj.,:;'|!]/.test(ch)) em += 0.27;
    else if (ch === " ") em += 0.27;
    else if (/[mwMW]/.test(ch)) em += 0.86;
    else if (/[A-Z]/.test(ch)) em += 0.66;
    else if (/[0-9]/.test(ch)) em += 0.57;
    else em += 0.53;
  }
  return em * size * (weight >= 600 ? 1.05 : 1);
}

/** Full SVG document with accessible name/description and the font classes. */
export function svgDoc({ w, h, id, title, desc, defs = "", body }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-labelledby="${id}-title ${id}-desc">
<title id="${id}-title">${esc(title)}</title>
<desc id="${id}-desc">${esc(desc)}</desc>
<defs>
<style>
text { font-family: ${SANS}; }
.m { font-family: ${MONO}; }
.t { font-variant-numeric: tabular-nums; }
</style>
${defs}
</defs>
<rect width="${w}" height="${h}" fill="${C.bg}"/>
${body}
</svg>
`;
}

/** Soft glow filter; used once per image at most, on the element that carries the meaning. */
export const glowFilter = (id, blur = 8, opacity = 0.55) =>
  `<filter id="${id}" x="-100%" y="-100%" width="300%" height="300%">
<feGaussianBlur in="SourceGraphic" stdDeviation="${blur}" result="b"/>
<feComponentTransfer in="b" result="g"><feFuncA type="linear" slope="${opacity}"/></feComponentTransfer>
<feMerge><feMergeNode in="g"/><feMergeNode in="SourceGraphic"/></feMerge>
</filter>`;
