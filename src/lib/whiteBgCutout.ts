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

const cache = new Map<string, string | null>();

/**
 * Minimum fraction of pixels the border flood fill must knock out for us to treat the source as a
 * genuine white-bg studio photo. Below this, the image had no removable white background (e.g. an
 * old employee snapshot with a real backdrop) — return null so the caller keeps the boxed render
 * instead of floating an opaque rectangle over the card's rings.
 * ponytail: 6% floor cleanly separates clean white-bg photos (knock out 20%+) from
 * no-background ones (~0%); raise if tight headshots that fill the frame get wrongly boxed.
 */
const MIN_KNOCKOUT_FRACTION = 0.06;

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

/**
 * Subject bounding box that ignores sparse noise: a row/column counts toward the box
 * only if it holds a meaningful number of opaque pixels. Stray specks (JPEG artefacts,
 * a leftover grey pixel below the shoulder) no longer inflate the box and leave the
 * subject floating in transparent padding. Falls back to `opaqueBounds` if nothing clears
 * the threshold. `minFrac` is the fraction of the perpendicular dimension a line must cover.
 */
export function subjectBounds(data: Uint8ClampedArray, w: number, h: number, minFrac = 0.03): Bounds | null {
  const rowCount = new Int32Array(h);
  const colCount = new Int32Array(w);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (data[(y * w + x) * 4 + 3] > 16) {
        rowCount[y]++;
        colCount[x]++;
      }
    }
  }
  const rowMin = Math.max(3, Math.round(w * minFrac));
  const colMin = Math.max(3, Math.round(h * minFrac));
  let minX = w, minY = h, maxX = -1, maxY = -1;
  for (let y = 0; y < h; y++) if (rowCount[y] >= rowMin) { if (y < minY) minY = y; if (y > maxY) maxY = y; }
  for (let x = 0; x < w; x++) if (colCount[x] >= colMin) { if (x < minX) minX = x; if (x > maxX) maxX = x; }
  if (maxX < 0 || maxY < 0) return opaqueBounds(data, w, h);
  return { minX, minY, maxX, maxY };
}

/**
 * Border-seeded flood fill: knock every near-white pixel connected to the image edge to alpha 0
 * (mutates `d` in place) and return how many pixels were knocked out. Interior white (a collar
 * surrounded by the subject) survives because it isn't reachable from the border. The count lets
 * the caller tell a real white-bg photo (knocks out a big fraction) from one with no removable
 * background (knocks out almost nothing).
 */
export function borderWhiteKnockout(d: Uint8ClampedArray, w: number, h: number): number {
  const visited = new Uint8Array(w * h);
  const stack: number[] = [];
  for (let x = 0; x < w; x++) {
    stack.push(x, (h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    stack.push(y * w, y * w + w - 1);
  }

  let knocked = 0;
  while (stack.length) {
    const p = stack.pop() as number;
    if (visited[p]) continue;
    visited[p] = 1;
    const i = p * 4;
    if (!isNeutralWhite(d[i], d[i + 1], d[i + 2])) continue;
    d[i + 3] = 0; // knock out to transparent
    knocked++;
    const px = p % w;
    const py = (p / w) | 0;
    if (px > 0) stack.push(p - 1);
    if (px < w - 1) stack.push(p + 1);
    if (py > 0) stack.push(p - w);
    if (py < h - 1) stack.push(p + w);
  }
  return knocked;
}

/** Fraction of the subject's height added as transparent headroom above the head. */
const HEADROOM = 0.14;

export async function whiteBgCutout(url: string): Promise<string | null> {
  if (cache.has(url)) return cache.get(url) ?? null;

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
  const knocked = borderWhiteKnockout(image.data, w, h);

  // No meaningful white background — leave the row to the boxed render.
  if (knocked / (w * h) < MIN_KNOCKOUT_FRACTION) {
    cache.set(url, null);
    return null;
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
  const b = subjectBounds(data, w, h);
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
