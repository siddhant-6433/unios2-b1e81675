import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const viewer = readFileSync("src/components/finance/FeeStructureViewer.tsx", "utf8");

describe("fee structure viewer matrix", () => {
  it("pivots non-school fee heads across year/semester columns", () => {
    expect(viewer).toContain("buildPeriodFeeMatrix");
    expect(viewer).toContain("feeTermLabel(term, metadata)");
    expect(viewer).toContain("Fee Head");
    expect(viewer).toContain("matrix.terms.map");
    expect(viewer).toContain("periodTotalLabel");
    expect(viewer).toContain("fee heads as rows, years/semesters as columns");
  });

  it("does not leak raw year_N terms in rendered fee item rows", () => {
    expect(viewer).toContain("termLabel(item.term)");
    expect(viewer).not.toContain("{item.term}</td>");
  });
});
