/**
 * Turn a passport photo with a solid pure-white studio background into a
 * transparent-background PNG, for placing the student over a decorative backdrop
 * (e.g. the Beacon ID-card "signal wave" rings).
 *
 * Our processed photos are guaranteed to have a pure-white (#FFFFFF) background
 * (the Gemini step composites one), so we don't need a heavy matting model —
 * we flood-fill near-white pixels *connected to the image border* and knock them
 * out to transparent. Because the fill starts at the border, interior white
 * (a white collar/shirt surrounded by the subject) is preserved.
 *
 * Runs entirely in the browser (canvas). Results are cached per source URL.
 */

const cache = new Map<string, string>();

/** Neutral near-white: bright and low-saturation (blue-striped shirts fail this). */
function isNeutralWhite(r: number, g: number, b: number): boolean {
  return r > 235 && g > 235 && b > 235 && Math.max(r, g, b) - Math.min(r, g, b) < 14;
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** Bounding box of pixels with alpha above `alphaMin`. Returns null if none. */
export function opaqueBounds(data: Uint8ClampedArray, w: number, h: number, alphaMin = 16): Bounds | null {
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > alphaMin) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  return maxX < 0 ? null : { minX, minY, maxX, maxY };
}

/** Fraction of the subject's height added as transparent headroom above the head. */
const HEADROOM = 0.14;

export async function whiteBgCutout(url: string): Promise<string> {
  const cached = cache.get(url);
  if (cached) return cached;

  const res = await fetch(url, { mode: "cors" });
  if (!res.ok) throw new Error(`photo fetch failed: ${res.status}`);
  const bitmap = await createImageBitmap(await res.blob());

  const w = bitmap.width;
  const h = bitmap.height;
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close?.();

  const image = ctx.getImageData(0, 0, w, h);
  const d = image.data;
  const visited = new Uint8Array(w * h);

  // Seed the flood fill from every border pixel.
  const stack: number[] = [];
  for (let x = 0; x < w; x++) {
    stack.push(x, (h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    stack.push(y * w, y * w + w - 1);
  }

  while (stack.length) {
    const p = stack.pop() as number;
    if (visited[p]) continue;
    visited[p] = 1;
    const i = p * 4;
    if (!isNeutralWhite(d[i], d[i + 1], d[i + 2])) continue;
    d[i + 3] = 0; // knock out to transparent
    const px = p % w;
    const py = (p / w) | 0;
    if (px > 0) stack.push(p - 1);
    if (px < w - 1) stack.push(p + 1);
    if (py > 0) stack.push(p - w);
    if (py < h - 1) stack.push(p + w);
  }

  ctx.putImageData(image, 0, 0);

  // Re-frame to a consistent headroom so the head never sits against the top edge,
  // regardless of how tightly the source passport crop framed it.
  const framed = reframeWithHeadroom(canvas, image.data, w, h);

  const out = framed.toDataURL("image/png");
  cache.set(url, out);
  return out;
}

/**
 * Crop to the subject's bounding box and re-pad with fixed headroom above the head
 * (and matching side margins), so every cutout has the same breathing room at the top.
 * Shoulders stay flush at the bottom so the subject "stands on" the card's rings.
 */
function reframeWithHeadroom(
  src: HTMLCanvasElement,
  data: Uint8ClampedArray,
  w: number,
  h: number,
): HTMLCanvasElement {
  const b = opaqueBounds(data, w, h);
  if (!b) return src; // fully transparent — leave as-is

  const sw = b.maxX - b.minX + 1;
  const sh = b.maxY - b.minY + 1;
  const padTop = Math.round(sh * HEADROOM);
  const padSide = Math.round(sw * 0.06);

  const outW = sw + padSide * 2;
  const outH = sh + padTop; // shoulders flush at bottom

  const out = document.createElement("canvas");
  out.width = outW;
  out.height = outH;
  const octx = out.getContext("2d");
  if (!octx) return src;
  octx.drawImage(src, b.minX, b.minY, sw, sh, padSide, padTop, sw, sh);
  return out;
}
