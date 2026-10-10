// CLI, 1600x700: a terminal window showing one docs lookup end to end.
// Columns are placed by x, not by padding spaces, so they align in any monospace font.
import { C, svgDoc, text, rect } from "./theme.mjs";

export const CLI = { w: 1600, h: 700 };

const SIZE = 22;
const LH = 33;

export function cliSvg(stats) {
  const { w, h } = CLI;
  const win = { x: 72, y: 36, w: w - 144, h: h - 72 };
  const left = win.x + 40;
  const p = [];

  p.push(rect(win.x, win.y, win.w, win.h, { r: 14, fill: "#0d1210", stroke: C.line2 }));
  p.push(`<line x1="${win.x + 1}" y1="${win.y + 48.5}" x2="${win.x + win.w - 1}" y2="${win.y + 48.5}" stroke="${C.line}"/>`);
  [0, 1, 2].forEach((i) => p.push(`<circle cx="${win.x + 26 + i * 22}" cy="${win.y + 24}" r="6" fill="${C.line2}"/>`));
  p.push(text(win.x + win.w / 2, win.y + 30, "~/my-app", { size: 15, mono: true, fill: C.muted, anchor: "middle" }));

  const date = new Date().toISOString().slice(0, 10);
  let y = win.y + 48 + 46;
  const t = (x, str, o = {}) => p.push(text(left + x, y, str, { size: SIZE, mono: true, fill: C.text2, ...o }));
  const next = (extra = 0) => (y += LH + extra);

  t(0, "$", { fill: C.teal });
  t(28, "gt-mcp docs react useEffect", { fill: C.text });
  next(10);

  const steps = [
    ["resolve", "facebook/react", `registry of ${stats.libraries}`, "2 ms", C.text2],
    ["fetch", "react.dev/llms.txt", "llms-txt", "412 ms", C.text2],
    ["rank", "6 of 48 sections", "bm25", "2,140 tokens", C.text2],
    ["gate", 'topic "useEffect"', "evidence", "pass", C.teal],
  ];
  for (const [verb, subject, kind, value, valueFill] of steps) {
    t(28, verb, { fill: C.muted });
    t(180, subject, { fill: C.text2 });
    t(580, kind, { fill: C.muted });
    t(1000, value, { fill: valueFill, anchor: "end" });
    next();
  }
  next(2);

  t(0, "##", { fill: C.muted });
  t(40, "useEffect", { fill: C.text, weight: 700 });
  next();
  t(0, "useEffect is a React Hook that lets you synchronize a component with an external system.");
  next(8);
  p.push(rect(left - 14, y - 27, 560, 42, { r: 8, fill: C.card2, stroke: null }));
  t(4, [["useEffect", { fill: C.text }], ["(setup, dependencies?)", { fill: C.text2 }]]);
  next(12);

  t(0, "##", { fill: C.muted });
  t(40, "Evidence", { fill: C.text, weight: 700 });
  next();
  for (const l of [
    `- Fetched live ${date} from official sources — not from model training data`,
    "- Source: https://react.dev/reference/react/useEffect (llms-txt)",
    "- Topic coverage: 1/1 terms, 23 occurrences, present in headings + code blocks",
  ]) {
    t(0, l);
    next();
  }
  next(4);
  t(0, "$", { fill: C.teal });
  p.push(`<rect x="${left + 28}" y="${y - 20}" width="13" height="26" fill="${C.teal}" opacity="0.85"/>`);

  return svgDoc({
    w,
    h,
    id: "cli",
    title: "gt-mcp docs react useEffect in a terminal",
    desc:
      `Terminal output of gt-mcp docs react useEffect: resolves facebook/react in the registry of ${stats.libraries} libraries, ` +
      "fetches react.dev/llms.txt, ranks 6 of 48 sections with BM25, passes the evidence gate, prints the useEffect reference, " +
      "and ends with an Evidence block listing the fetch date, the source URL and topic coverage.",
    body: p.join("\n"),
  });
}
