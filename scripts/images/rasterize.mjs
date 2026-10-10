// SVG -> PNG via a local headless Chrome, falling back to the Playwright CLI.
import { execFileSync } from "child_process";
import { mkdtempSync, writeFileSync, rmSync, existsSync, statSync, accessSync, constants } from "fs";
import { tmpdir } from "os";
import { join, delimiter } from "path";
import { pathToFileURL } from "url";

const CHROME_CANDIDATES = ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "chrome"];

function onPath(bin) {
  return (process.env.PATH ?? "").split(delimiter).some((dir) => {
    try {
      accessSync(join(dir, bin), constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}

/** Picks a renderer once. Throws a message that says exactly what to install. */
export function findRenderer() {
  const forced = process.env.CHROME_BIN;
  if (forced) {
    if (!existsSync(forced) && !onPath(forced)) throw new Error(`CHROME_BIN=${forced} does not exist`);
    return { kind: "chrome", bin: forced };
  }
  const chrome = CHROME_CANDIDATES.find(onPath);
  if (chrome) return { kind: "chrome", bin: chrome };
  if (onPath("playwright")) return { kind: "playwright", bin: "playwright" };
  throw new Error(
    "No PNG renderer found. Install Google Chrome or Chromium (google-chrome / chromium on PATH), " +
      "set CHROME_BIN=/path/to/chrome, or install the Playwright CLI (npm i -g playwright && playwright install chromium). " +
      "SVG files were still written.",
  );
}

/** Wraps the SVG in a zero-margin page sized exactly to the image and screenshots it. */
export function rasterize(renderer, svg, w, h, outPng) {
  const dir = mkdtempSync(join(tmpdir(), "gt-img-"));
  try {
    const html = join(dir, "page.html");
    writeFileSync(
      html,
      `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;overflow:hidden;background:#0a0d0c}svg{display:block}</style></head><body>${svg}</body></html>`,
    );
    const url = pathToFileURL(html).href;
    if (renderer.kind === "chrome") {
      execFileSync(
        renderer.bin,
        [
          "--headless=new",
          "--disable-gpu",
          "--no-sandbox",
          "--hide-scrollbars",
          "--force-device-scale-factor=1",
          "--default-background-color=0a0d0cff",
          "--font-render-hinting=none",
          `--user-data-dir=${join(dir, "profile")}`,
          `--window-size=${w},${h}`,
          `--screenshot=${outPng}`,
          url,
        ],
        { stdio: ["ignore", "ignore", "pipe"], timeout: 60_000 },
      );
    } else {
      execFileSync(renderer.bin, ["screenshot", `--viewport-size=${w},${h}`, url, outPng], {
        stdio: ["ignore", "ignore", "pipe"],
        timeout: 60_000,
      });
    }
    if (!existsSync(outPng) || statSync(outPng).size === 0) throw new Error(`${renderer.bin} produced no PNG for ${outPng}`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
