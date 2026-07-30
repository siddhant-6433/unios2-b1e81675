import { describe, expect, it } from "vitest";
import { subjectBounds } from "@/lib/whiteBgCutout";

/** Build an RGBA buffer of size w×h; `opaque(x,y)` decides alpha. */
function buf(w: number, h: number, opaque: (x: number, y: number) => boolean): Uint8ClampedArray {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d[(y * w + x) * 4 + 3] = opaque(x, y) ? 255 : 0;
  return d;
}

describe("subjectBounds", () => {
  it("ignores a lone stray speck that opaqueBounds would include", () => {
    const w = 100, h = 100;
    // A dense 40×40 block top-left + a single stray pixel at the bottom-right corner.
    const d = buf(w, h, (x, y) => (x < 40 && y < 40) || (x === 99 && y === 99));
    const b = subjectBounds(d, w, h)!;
    expect(b.maxY).toBeLessThan(60); // speck at y=99 excluded → subject stays the top block
    expect(b.maxX).toBeLessThan(60);
  });

  it("keeps the full subject when it is dense", () => {
    const b = subjectBounds(buf(50, 80, (x, y) => x >= 10 && x < 40 && y >= 5 && y < 70), 50, 80)!;
    expect(b.minX).toBe(10);
    expect(b.maxX).toBe(39);
    expect(b.minY).toBe(5);
    expect(b.maxY).toBe(69);
  });
});
