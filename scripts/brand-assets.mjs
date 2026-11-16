// Draws every icon and graphic from SomniAI's one mark (play/brand/mark.mjs),
// prompt 7.5. Until then the Android app wore Capacitor's template logo and the
// web app's icon files were empty.
//
//   node scripts/brand-assets.mjs
//
// Writes, at the sizes they already had:
//   android/.../mipmap-*/ic_launcher.png, ic_launcher_round.png, ic_launcher_foreground.png
//   android/.../values/ic_launcher_background.xml (the adaptive icon's background)
//   android/.../drawable*/splash.png
//   public/icons/icon.svg, icon-maskable.svg
//   play/listing/en-US/graphics/icon.png (512) and featureGraphic.jpg (1024 x 500)
// and removes Android Studio's unused template drawables.
import { chromium } from "playwright";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { NIGHT, MOON, iconSvg, markSvg } from "../play/brand/mark.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const RES = join(ROOT, "android", "app", "src", "main", "res");
const GRAPHICS = join(ROOT, "play", "listing", "en-US", "graphics");

/** Width and height from a PNG's header. */
export function pngSize(buf) {
  if (buf.toString("ascii", 1, 4) !== "PNG") {
    throw new Error("not a PNG");
  }
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
}

const DENSITIES = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };

/** The mark alone on a transparent 108 canvas: the adaptive icon's foreground. */
function foregroundSvg(size) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 108 108">${markSvg()}</svg>`;
}

/** The mark centred on the night sky, filling `fraction` of the shorter side. */
function splashSvg(width, height, fraction = 0.32) {
  const side = Math.min(width, height) * fraction;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`
    + `<rect width="100%" height="100%" fill="${NIGHT}"/>`
    + `<svg x="${(width - side) / 2}" y="${(height - side) / 2}" width="${side}" height="${side}" viewBox="0 0 108 108">${markSvg()}</svg></svg>`;
}

function featureGraphicHtml() {
  return `<div style="width:1024px;height:500px;background:${NIGHT};display:flex;align-items:center;gap:44px;padding:0 84px;box-sizing:border-box;font-family:'Segoe UI',Roboto,Arial,sans-serif">
    <svg width="250" height="250" viewBox="0 0 108 108">${markSvg()}</svg>
    <div>
      <div style="color:#fff;font-size:84px;font-weight:700;letter-spacing:-1px">SomniAI</div>
      <div style="color:${MOON};font-size:36px;margin-top:10px;line-height:1.25">The alarm that makes sure<br>you're actually up.</div>
    </div></div>`;
}

async function render(page, html, width, height, transparent = false, type = "png") {
  await page.setViewportSize({ width, height });
  await page.setContent(`<!doctype html><html><body style="margin:0;background:transparent">${html}</body></html>`);
  return page.screenshot({ clip: { x: 0, y: 0, width, height }, omitBackground: transparent, type, ...(type === "jpeg" ? { quality: 95 } : {}) });
}

function write(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, data);
  console.log(`  ${path.slice(ROOT.length).replace(/\\/g, "/")}`);
}

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  try {
    for (const [density, scale] of Object.entries(DENSITIES)) {
      const dir = join(RES, `mipmap-${density}`);
      const legacy = Math.round(48 * scale);
      const fg = Math.round(108 * scale);
      write(join(dir, "ic_launcher.png"), await render(page, iconSvg(legacy, "rounded"), legacy, legacy, true));
      write(join(dir, "ic_launcher_round.png"), await render(page, iconSvg(legacy, "round"), legacy, legacy, true));
      write(join(dir, "ic_launcher_foreground.png"), await render(page, foregroundSvg(fg), fg, fg, true));
    }
    write(join(RES, "values", "ic_launcher_background.xml"),
      `<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">${NIGHT}</color>\n</resources>\n`);
    // Android Studio's template robot, referenced by nothing (the adaptive icon uses the mipmaps).
    for (const f of [join(RES, "drawable-v24", "ic_launcher_foreground.xml"), join(RES, "drawable", "ic_launcher_background.xml")]) {
      if (existsSync(f)) {
        rmSync(f);
        console.log(`  removed ${f.slice(ROOT.length).replace(/\\/g, "/")}`);
      }
    }
    for (const dir of readdirSync(RES).filter((d) => d === "drawable" || d.startsWith("drawable-"))) {
      const file = join(RES, dir, "splash.png");
      if (existsSync(file)) {
        const { width, height } = pngSize(readFileSync(file));
        write(file, await render(page, splashSvg(width, height), width, height));
      }
    }
    write(join(ROOT, "public", "icons", "icon.svg"), iconSvg(512, "rounded") + "\n");
    // Maskable: full bleed, the mark already inside the safe circle.
    write(join(ROOT, "public", "icons", "icon-maskable.svg"), iconSvg(512, "square") + "\n");
    // Google Play draws its own rounded corners and shadow: a full square.
    write(join(GRAPHICS, "icon.png"), await render(page, iconSvg(512, "square"), 512, 512));
    // Play wants the feature graphic without an alpha channel: JPEG has none.
    write(join(GRAPHICS, "featureGraphic.jpg"), await render(page, featureGraphicHtml(), 1024, 500, false, "jpeg"));
  }
  finally {
    await browser.close();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
