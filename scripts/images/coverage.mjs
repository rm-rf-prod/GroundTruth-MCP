// Coverage, 1600x900: libraries per language ecosystem as one ranked bar series.
// Every bar carries its value at the tip, so no value axis is drawn.
import { C, svgDoc, text, line, hbar, textWidth, esc } from "./theme.mjs";
import { topEcosystems } from "./data.mjs";

export const COVERAGE = { w: 1600, h: 900 };

export function coverageSvg(stats) {
  const { w, h } = COVERAGE;
  const rows = topEcosystems(stats);
  const p = [];

  p.push(text(72, 104, `${stats.libraries} libraries across ${stats.ecosystems.length} ecosystems`, { size: 36, weight: 600 }));
  p.push(
    text(72, 144, "Registry entries per language ecosystem. A library that supports several ecosystems counts in each.", {
      size: 21,
      fill: C.text2,
    }),
  );

  const top = 206;
  const bottom = h - 72;
  const pitch = Math.min(44, (bottom - top) / rows.length);
  const barH = Math.min(24, Math.round(pitch * 0.58));
  const labelRight = 72 + Math.ceil(Math.max(...rows.map((r) => textWidth(r.label, 20))) + 8);
  const x0 = labelRight + 24;
  const max = Math.max(...rows.map((r) => r.count));
  const valueRoom = 80;
  const scale = (w - 72 - valueRoom - x0) / max;

  rows.forEach((r, i) => {
    const cy = Math.round(top + pitch * i + pitch / 2);
    const len = Math.max(2, Math.round(r.count * scale));
    const fill = r.other ? C.barMuted : C.bar;
    p.push(`<g><title>${esc(r.label)}: ${r.count}</title>`);
    p.push(text(labelRight, cy + 7, r.label, { size: 20, fill: r.other ? C.text2 : C.text, anchor: "end" }));
    p.push(hbar(x0, cy - barH / 2, len, barH, fill));
    p.push(text(x0 + len + 12, cy + 7, String(r.count), { size: 19, weight: 600, fill: C.text }));
    if (r.other) {
      const detail = r.members.map((m) => `${m.label} ${m.count}`).join(", ");
      const dx = x0 + len + 12 + textWidth(String(r.count), 19, { weight: 600 }) + 22;
      p.push(text(dx, cy + 6, detail, { size: 16, mono: true, fill: C.muted }));
    }
    p.push("</g>");
  });

  // Baseline the bars grow from.
  p.push(line(x0 + 0.5, top - 8, x0 + 0.5, top + pitch * rows.length + 8, C.line2));

  const listed = rows.map((r) => `${r.label} ${r.count}`).join(", ");
  const other = rows.find((r) => r.other);
  return svgDoc({
    w,
    h,
    id: "coverage",
    title: `GroundTruth coverage: ${stats.libraries} libraries across ${stats.ecosystems.length} ecosystems`,
    desc:
      `Horizontal bar chart of registry libraries per language ecosystem; a library that supports several ecosystems counts in each. ${listed}.` +
      (other ? ` Other combines ${other.members.map((m) => `${m.label} ${m.count}`).join(", ")}.` : ""),
    body: p.join("\n"),
  });
}
