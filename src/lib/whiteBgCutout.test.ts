import { describe, expect, it } from "vitest";
import { borderWhiteKnockout, opaqueBounds } from "./whiteBgCutout";

/** Build a w×h RGBA buffer, marking the given pixels opaque (alpha 255). */
function buf(w: number, h: number, opaque: [number, number][]): Uint8ClampedArray {
  const d = new Uint8ClampedArray(w * h * 4);
  for (const [x, y] of opaque) d[(y * w + x) * 4 + 3] = 255;
  return d;
}

/** Build a w×h RGBA buffer where fill(x,y) gives the [r,g,b] of each pixel (all opaque). */
function rgb(w: number, h: number, fill: (x: number, y: number) => [number, number, number]): Uint8ClampedArray {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const [r, g, b] = fill(x, y);
      d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255;
    }
  }
  return d;
}

describe("opaqueBounds", () => {
  it("finds the tight bounding box of opaque pixels", () => {
    // 6×6, subject occupies x∈[2,4], y∈[1,3]
    const d = buf(6, 6, [
      [2, 1], [4, 1],
      [3, 2],
      [2, 3], [4, 3],
    ]);
    expect(opaqueBounds(d, 6, 6)).toEqual({ minX: 2, minY: 1, maxX: 4, maxY: 3 });
  });

  it("returns null when nothing is opaque", () => {
    expect(opaqueBounds(buf(4, 4, []), 4, 4)).toBeNull();
  });

  it("ignores near-transparent pixels below the alpha floor", () => {
    const d = new Uint8ClampedArray(2 * 2 * 4);
    d[3] = 10; // alpha 10 < default floor 16
    expect(opaqueBounds(d, 2, 2)).toBeNull();
  });
});

describe("borderWhiteKnockout", () => {
  it("knocks out a white background but preserves a non-white subject", () => {
    // 10×10 pure-white bg with a dark 4×4 subject block in the middle (x,y ∈ [3,6]).
    const w = 10, h = 10;
    const d = rgb(w, h, (x, y) => (x >= 3 && x <= 6 && y >= 3 && y <= 6 ? [20, 20, 20] : [255, 255, 255]));
    const knocked = borderWhiteKnockout(d, w, h);
    // 100 pixels total, 16 are subject → 84 white knocked out.
    expect(knocked).toBe(84);
    // Subject centre keeps full alpha; a corner is now transparent.
    expect(d[(4 * w + 4) * 4 + 3]).toBe(255);
    expect(d[(0 * w + 0) * 4 + 3]).toBe(0);
  });

  it("preserves interior white not connected to the border", () => {
    // Dark ring around the frame, white hole in the middle — the hole must survive.
    const w = 6, h = 6;
    const d = rgb(w, h, (x, y) =>
      x === 0 || y === 0 || x === w - 1 || y === h - 1 ? [255, 255, 255] : [10, 10, 10],
    );
    // Put one white pixel deep inside the dark region.
    const inner = (3 * w + 3) * 4;
    d[inner] = 255; d[inner + 1] = 255; d[inner + 2] = 255;
    borderWhiteKnockout(d, w, h);
    expect(d[inner + 3]).toBe(255); // interior white kept
  });

  it("knocks out almost nothing when there is no white background", () => {
    // A photo with a real (mid-grey) backdrop — nothing is neutral-white.
    const w = 8, h = 8;
    const d = rgb(w, h, () => [120, 130, 120]);
    expect(borderWhiteKnockout(d, w, h)).toBe(0);
  });
});
