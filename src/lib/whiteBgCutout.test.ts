import { describe, expect, it } from "vitest";
import { opaqueBounds } from "./whiteBgCutout";

/** Build a w×h RGBA buffer, marking the given pixels opaque (alpha 255). */
function buf(w: number, h: number, opaque: [number, number][]): Uint8ClampedArray {
  const d = new Uint8ClampedArray(w * h * 4);
  for (const [x, y] of opaque) d[(y * w + x) * 4 + 3] = 255;
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
