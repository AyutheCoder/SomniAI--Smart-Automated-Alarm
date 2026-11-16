// SomniAI's mark (prompt 7.5): a crescent moon with two arcs ringing from it.
// One source for every icon: the Android launcher (vector and PNGs), the
// splash screens, the web app's icons and the Play listing's graphics
// (scripts/brand-assets.mjs draws them all from here).
//
// Drawn on Android's adaptive-icon canvas, 108 x 108, with everything inside
// the 66-unit circle that no launcher mask cuts off.

export const NIGHT = "#0B1020"; // the web app's theme colour (manifest.webmanifest)
export const MOON = "#F6C667";
export const RING = "#8FB8FF";

// The crescent: circle A (50,54) r22 less circle B (61,46) r18; they meet at
// (49.69,32.00) and (70.83,61.08). Outer edge along A, inner edge along B.
export const CRESCENT = "M49.69,32.00 A22,22 0 1,0 70.83,61.08 A18,18 0 0,1 49.69,32.00 Z";

// Two arcs around the moon's upper horn, as if it were ringing.
export const RINGS = [
  "M63.5,30.5 A9,9 0 0,1 72.5,39.5",
  "M64.5,23.0 A16,16 0 0,1 80.0,38.5",
];
export const RING_WIDTH = 3.2;

// The drawing sits a little high and right; this centres it, and brings the
// outer arc's top (64.5,23) inside the 33-unit safe circle around (54,54).
export const OFFSET = { x: -1, y: 3 };

/** The mark as SVG elements in the 108 canvas. */
export function markSvg() {
  return `<g transform="translate(${OFFSET.x},${OFFSET.y})"><path d="${CRESCENT}" fill="${MOON}"/>`
    + RINGS.map((d) => `<path d="${d}" fill="none" stroke="${RING}" stroke-width="${RING_WIDTH}" stroke-linecap="round"/>`).join("")
    + "</g>";
}

/** The full icon: night background (square, round or rounded) and the mark, at any size. */
export function iconSvg(size, shape = "square") {
  const bg = shape === "round"
    ? `<circle cx="54" cy="54" r="54" fill="${NIGHT}"/>`
    : `<rect width="108" height="108" rx="${shape === "rounded" ? 24 : 0}" fill="${NIGHT}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 108 108">${bg}${markSvg()}</svg>`;
}
