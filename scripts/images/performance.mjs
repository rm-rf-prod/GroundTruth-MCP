// Performance, 1600x900: before/after pairs per metric, drawn as small multiples.
// Metrics carry different units, so every row has its own scale (never one shared axis).
import { C, svgDoc, text, rect, hbar, textWidth, esc } from "./theme.mjs";

export const PERF = { w: 1600, h: 900 };

const TIME_UNITS = new Set(["ns", "us", "µs", "ms", "s", "sec", "min"]);

const fmt = (v) => new Intl.NumberFormat("en-US", { maximumFractionDigits: v < 10 ? 2 : v < 100 ? 1 : 0 }).format(v);
const withUnit = (v, unit) => (unit ? `${fmt(v)} ${unit}` : fmt(v));

/** "6.8x faster", or the honest word when a metric got worse. */
export function verdict(m) {
  const lowerIsBetter = (m.better ?? "lower") === "lower";
  const ratio = lowerIsBetter ? m.before / m.after : m.after / m.before;
  const improved = ratio >= 1;
  const x = improved ? ratio : 1 / ratio;
  const factor = `${x >= 10 ? Math.round(x) : x.toFixed(1)}x`;
  const timed = TIME_UNITS.has(m.unit.toLowerCase());
  const word = lowerIsBetter
    ? improved ? (timed ? "faster" : "smaller") : timed ? "slower" : "larger"
    : improved ? "higher" : "lower";
  return { factor, word, improved };
}

function wrap(label, max = 28) {
  const words = label.split(/\s+/);
  const lines = [""];
  for (const wd of words) {
    const cur = lines[lines.length - 1];
    if (cur && (cur + " " + wd).length > max) lines.push(wd);
    else lines[lines.length - 1] = cur ? `${cur} ${wd}` : wd;
  }
  return lines.slice(0, 2);
}

export function performanceSvg(metrics) {
  const { w, h } = PERF;
  const p = [];

  p.push(text(72, 104, "Before and after", { size: 36, weight: 600 }));
  p.push(text(72, 144, "Bars are scaled per row. Lower is better unless a row says otherwise.", { size: 21, fill: C.text2 }));

  // Legend: two series, so it is always present.
  const lg = [["Before", C.barMuted], ["After", C.bar]];
  let lx = w - 72;
  for (const [label, color] of [...lg].reverse()) {
    lx -= textWidth(label, 19) + 8;
    p.push(text(lx, 104, label, { size: 19, fill: C.text2 }));
    p.push(rect(lx - 26, 89, 16, 16, { r: 4, fill: color, stroke: null }));
    lx -= 26 + 28;
  }

  const top = 196;
  const bottom = h - 64;
  const pitch = Math.min(150, (bottom - top) / metrics.length);
  const barH = 22;
  const pairGap = 6;
  const x0 = 72 + Math.ceil(Math.max(...metrics.flatMap((m) => wrap(m.label).map((l) => textWidth(l, 21))))) + 56;
  const verdictRight = w - 72;
  const barMax = verdictRight - 300 - x0;

  metrics.forEach((m, i) => {
    const y = top + pitch * i;
    const mid = y + pitch / 2;
    if (i > 0) p.push(`<line x1="72" y1="${y + 0.5}" x2="${w - 72}" y2="${y + 0.5}" stroke="${C.line}"/>`);

    const lines = wrap(m.label);
    lines.forEach((l, j) => p.push(text(72, mid + 7 + (j - (lines.length - 1) / 2) * 28, l, { size: 21, fill: C.text })));
    if (m.better === "higher") p.push(text(72, mid + 7 + ((lines.length + 1) / 2) * 28 - 2, "higher is better", { size: 15, mono: true, fill: C.muted }));

    const max = Math.max(m.before, m.after);
    const bars = [
      [m.before, C.barMuted, C.text2, "before"],
      [m.after, C.bar, C.text, "after"],
    ];
    bars.forEach(([v, fill, ink, name], j) => {
      const by = Math.round(mid - barH - pairGap / 2 + j * (barH + pairGap));
      const len = Math.max(2, Math.round((v / max) * barMax));
      p.push(`<g><title>${esc(m.label)}, ${name}: ${esc(withUnit(v, m.unit))}</title>`);
      p.push(hbar(x0, by, len, barH, fill));
      p.push(text(x0 + len + 12, by + 17, withUnit(v, m.unit), { size: 18, fill: ink, weight: j ? 600 : 400 }));
      p.push("</g>");
    });

    const v = verdict(m);
    p.push(
      text(verdictRight, mid + 10, [[v.factor, { weight: 700, fill: C.text, size: 30 }], [` ${v.word}`, { fill: C.text2, size: 20 }]], {
        anchor: "end",
      }),
    );
  });

  p.push(`<line x1="${x0 + 0.5}" y1="${top + 12}" x2="${x0 + 0.5}" y2="${top + pitch * metrics.length - 12}" stroke="${C.line2}"/>`);

  const desc = metrics
    .map((m) => {
      const v = verdict(m);
      return `${m.label}: before ${withUnit(m.before, m.unit)}, after ${withUnit(m.after, m.unit)}, ${v.factor} ${v.word}`;
    })
    .join(". ");
  return svgDoc({
    w,
    h,
    id: "performance",
    title: "GroundTruth performance, before and after",
    desc: `Paired horizontal bars per metric, each row on its own scale. ${desc}.`,
    body: p.join("\n"),
  });
}
