import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";

const tsxFiles = () =>
  execSync('grep -rl "" src --include="*.tsx" || true', { encoding: "utf8" })
    .trim()
    .split("\n")
    .filter(Boolean);

describe("thinking orb sweep", () => {
  /**
   * Full-view and section loading states use an orb, not a spinning Loader2.
   * Small in-button spinners were swept too; what survives is deliberately
   * tiny (h-3 badges, an h-2.5 matrix cell) where a 20px orb would dwarf its
   * siblings. The h-5 threshold is what the first pass got wrong.
   */
  it("has no large spinning Loader2 left in src", () => {
    const offenders: string[] = [];
    for (const file of tsxFiles()) {
      const src = readFileSync(file, "utf8");
      for (const [, cls] of src.matchAll(/<Loader2\s+className="([^"]*)"/g)) {
        if (cls.includes("animate-spin") && /\bh-(?:5|6|7|8|10|12)\b/.test(cls)) {
          offenders.push(`${file}: ${cls}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  /**
   * The orb is monochrome ink and resolves light-vs-dark by walking ancestors
   * for a dark/light class, falling back to prefers-color-scheme. This app is
   * light-only (no .dark rule, no theme provider), so without the marker on
   * <html> every orb renders light ink on our light background for OS-dark
   * users — invisible, with no test failure and no visual diff in a
   * light-mode browser. That is why this assertion exists.
   */
  it("pins the theme marker on <html> so orbs stay visible for OS-dark users", () => {
    const html = readFileSync("index.html", "utf8");
    expect(html).toMatch(/<html[^>]*\bclass="[^"]*\blight\b/);
  });

  /**
   * The library always sets role="img" plus a per-state aria-label, so a bare
   * orb inside a button reading "Saving…" announces "Working… Saving…".
   * Every raw ThinkingOrb must either be labelled (it is the only thing
   * announcing state) or hidden (the surrounding text is the label).
   * OrbLoader and ButtonOrb both handle this; this catches direct use.
   */
  it("gives every raw ThinkingOrb either a label or aria-hidden", () => {
    const offenders: string[] = [];
    for (const file of tsxFiles()) {
      if (file.endsWith("ui/thinking-orb.tsx")) continue;
      const src = readFileSync(file, "utf8");
      for (const [tag] of src.matchAll(/<ThinkingOrb\b[^>]*\/>/g)) {
        if (!/aria-hidden|aria-label|\blabel=/.test(tag)) offenders.push(`${file}: ${tag}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
