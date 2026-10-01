// Intl.Segmenter is available in the Deno/edge runtime and every supported
// browser, but not in the app's ES2020 type library.
const Segmenter = (Intl as unknown as { Segmenter: new (locale?: string, options?: { granularity: "grapheme" }) => { segment(input: string): Iterable<{ segment: string }> } }).Segmenter;

/** Word wrap using measured glyph widths; never truncates an identifier/name. */
export function wrapReportText(
  text: string,
  maxWidth: number,
  measure: (text: string) => number,
): string[] {
  if (maxWidth <= 0) throw new Error("Invalid text width");
  const output: string[] = [];
  for (const paragraph of text.replace(/\r\n?/g, "\n").split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? `${line} ${word}` : word;
      if (measure(candidate) <= maxWidth) { line = candidate; continue; }
      if (line) { output.push(line); line = ""; }
      // Grapheme segmentation preserves Indic clusters and combining accents.
      const pieces = Array.from(new Segmenter("en", { granularity: "grapheme" }).segment(word), part => part.segment);
      for (const piece of pieces) {
        if (line && measure(line + piece) > maxWidth) { output.push(line); line = ""; }
        if (measure(piece) > maxWidth) throw new Error("Glyph exceeds available width");
        line += piece;
      }
    }
    output.push(line);
  }
  return output;
}
