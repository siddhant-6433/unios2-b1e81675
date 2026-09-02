import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  defaultFeeTermLabel,
  feeTermLabel,
  feeTermLabelLong,
  feeTermLabelWithMonths,
  feeTermGroupLabel,
  feePeriodNoun,
  ONE_TIME_GROUP,
} from "@/lib/feeTermLabels";

// A fee term is stored as free text (year_1, q1, m_2026_07). "year_2" does NOT
// reliably mean a year: D.AOTT bills 5 semesters and stores them as
// year_1..year_5, exactly like a programme that really is billed annually. Only
// the fee structure's own metadata can tell the two apart — these tests pin
// that down in both directions, because the regression that matters is
// relabelling the 19 courses whose year_N terms genuinely are years.

// The live D.AOTT stetho_batch structure, trimmed to the labelling keys.
const DAOTT_META = {
  period_label: "Semester",
  period_label_plural: "Semester-wise Breakdown",
  duration_label: "2.5 yrs · 5 semesters",
  year_1: { fee: 40000, label: "Sem 1" },
  year_2: { fee: 40000, label: "Sem 2" },
  year_5: { fee: 25000, label: "Sem 5" },
};

describe("fee term labels", () => {
  it("leaves an annual programme alone when there is no metadata", () => {
    // MBA, BBA, GNM, B.Ed … 21 of 22 courses. This is the regression guard.
    expect(feeTermLabel("year_1", null)).toBe("Year 1");
    expect(feeTermLabel("year_3", undefined)).toBe("Year 3");
    expect(feeTermLabelLong("year_1", null)).toBe("Year 1");
    expect(defaultFeeTermLabel("year_2")).toBe("Year 2");
  });

  it("prefers the structure's own short label in dense tables", () => {
    expect(feeTermLabel("year_1", DAOTT_META)).toBe("Sem 1");
    expect(feeTermLabel("year_5", DAOTT_META)).toBe("Sem 5");
  });

  it("falls back to period_label for a term with no explicit label", () => {
    // year_3/year_4 carry no `label` key in the trimmed fixture.
    expect(feeTermLabel("year_3", DAOTT_META)).toBe("Semester 3");
    expect(feeTermLabel("year_3", { period_label: "Semester" })).toBe("Semester 3");
  });

  it("spells the period out in prose, ignoring the abbreviated label", () => {
    // "Sem 1" reads fine in a table cell, badly in a WhatsApp message.
    expect(feeTermLabelLong("year_1", DAOTT_META)).toBe("Semester 1");
    expect(feeTermLabelLong("year_5", DAOTT_META)).toBe("Semester 5");
  });

  it("carries the period through to late-fine heads", () => {
    // late_year_2 used to title-case to "Late Year 2" and kept saying Year.
    expect(feeTermLabel("late_year_2", DAOTT_META)).toBe("Late Fee — Sem 2");
    expect(feeTermLabelLong("late_year_2", DAOTT_META)).toBe("Late Fee — Semester 2");
    expect(feeTermLabel("late_year_2", null)).toBe("Late Fee — Year 2");
    expect(feeTermLabel("late_q1", null)).toBe("Late Fee — Q1");
  });

  it("keeps the non-series terms unchanged", () => {
    expect(feeTermLabel("registration", DAOTT_META)).toBe("Application Fee");
    expect(feeTermLabel("adhoc", DAOTT_META)).toBe("Other Charges");
    expect(feeTermLabel("m_2026_07", DAOTT_META)).toBe("Jul 2026");
    expect(feeTermLabel("security_deposit", null)).toBe("Security Deposit (Refundable)");
    expect(feeTermGroupLabel(ONE_TIME_GROUP, DAOTT_META)).toBe("One-time Fees");
  });

  it("keeps the verbose quarter wording for school ledgers", () => {
    expect(feeTermLabelWithMonths("q1", null)).toBe("Quarter 1 (Apr–Jun)");
    expect(feeTermLabelWithMonths("q4", null)).toBe("Quarter 4 (Jan–Mar)");
    // A semester programme's own wording still wins over the quarter default.
    expect(feeTermLabelWithMonths("year_2", DAOTT_META)).toBe("Semester 2");
  });

  it("exposes the period noun for copy that isn't a numbered term", () => {
    expect(feePeriodNoun(null)).toBe("Year");
    expect(feePeriodNoun(null, { plural: true })).toBe("Years");
    expect(feePeriodNoun(DAOTT_META)).toBe("Semester");
    expect(feePeriodNoun(DAOTT_META, { plural: true })).toBe("Semesters");
    // period_label_plural is a section heading ("Semester-wise Breakdown"), not a noun.
    expect(feePeriodNoun(DAOTT_META, { plural: true })).not.toContain("Breakdown");
  });
});

describe("the Deno copy cannot drift from src/lib", () => {
  // Edge functions (offer letter, loan letter, Navya's fee context) cannot
  // import from src/, so the helper is duplicated. Assert the two agree on
  // output rather than on source text — a comment must not fail the build, but
  // a diverging label must.
  const CASES: [string, Record<string, unknown> | null][] = [
    ["year_1", null], ["year_3", null], ["year_1", DAOTT_META], ["year_3", DAOTT_META],
    ["year_5", DAOTT_META], ["sem_2", null], ["q1", null], ["q4", DAOTT_META],
    ["late_year_2", DAOTT_META], ["late_q1", null], ["m_2026_07", null],
    ["registration", DAOTT_META], ["adhoc", null], ["security_deposit", null],
    ["admission", null], ["installment_3", null], ["term_2", null], ["uniform_2026", null],
  ];

  it("produces identical labels for every term shape", async () => {
    const deno = await import("../../supabase/functions/_shared/feeTermLabels.ts");
    for (const [term, meta] of CASES) {
      expect(deno.feeTermLabel(term, meta), `feeTermLabel(${term})`)
        .toBe(feeTermLabel(term, meta));
      expect(deno.feeTermLabelLong(term, meta), `feeTermLabelLong(${term})`)
        .toBe(feeTermLabelLong(term, meta));
    }
  });

  it("agrees that D.AOTT reads as semesters and a plain course does not", async () => {
    const deno = await import("../../supabase/functions/_shared/feeTermLabels.ts");
    expect(deno.feeTermLabel("year_1", DAOTT_META)).toBe("Sem 1");
    expect(deno.feeTermLabelLong("year_1", DAOTT_META)).toBe("Semester 1");
    expect(deno.feeTermLabel("year_1", null)).toBe("Year 1");
    expect(deno.feePeriodNoun(DAOTT_META, { plural: true })).toBe("Semesters");
    expect(deno.feePeriodNoun(null)).toBe("Year");
  });
});

describe("edge functions label through the shared helper", () => {
  const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

  it("Navya's fee context no longer title-cases the raw term", () => {
    const ctx = read("supabase/functions/_shared/nimt-admissions-context.ts");
    expect(ctx).toContain("feeTermLabelLong(item.term, feeStructure?.metadata)");
    // titleCaseTerm was the thing printing "Year 1" into the prompt.
    expect(ctx).not.toContain("titleCaseTerm");
    // D.AOTT has 16 fee items; the old 12-item slice hid its final semester.
    expect(ctx).toContain(".slice(0, 40)");
    // Per-term metadata keys (year_1…year_5 + total_fee) were never read, so
    // D.AOTT contributed no fee summary at all.
    expect(ctx).toContain("metadata.total_fee");
    expect(ctx).toContain("duration_label");
  });

  it("the offer letter drops its hardcoded D.AOTT check", () => {
    const offer = read("supabase/functions/generate-offer-letter/index.ts");
    expect(offer).toContain("function labelForOfferTerm(term: string, meta?");
    expect(offer).not.toContain('term.replace(/^year_(\\d+)$/, "Sem $1")');
    expect(offer).not.toContain('isDaott ? "Semester 1"');
    // The metadata has to actually be fetched and threaded through.
    expect(offer).toContain("policy, metadata, fee_structure_items");
    expect(offer).toContain("feeStructureMeta: yearRows?.metadata");
  });

  it("the loan letter schedule heads its column with the real period", () => {
    const loan = read("supabase/functions/generate-loan-letter/index.ts");
    expect(loan).toContain("feeTermLabel(item.term, meta)");
    expect(loan).toContain("feeTermLabelLong(\"year_1\", opts.feeStructureMeta)");
    expect(loan).not.toContain("First-Year Applicable Fee");
    expect(loan).not.toContain("First-Year Amount Due");
    expect(loan).toContain('.select("id, metadata, fee_structure_items ( term, amount )")');
  });

  it("the student login labels through metadata, not a baked Year fallback", () => {
    const portal = read("src/pages/StudentPortal.tsx");
    expect(portal).toContain("feeTermGroupLabel(g.term, feeMeta, { long: true })");
    expect(portal).toContain("feeTermLabelLong(fee.term, feeMeta)");
    expect(portal).toContain("feePeriodNoun(feeMeta)");
    expect(portal).not.toContain("feeTermLabelLong(f.term)");
    const parent = read("src/pages/ParentPortal.tsx");
    expect(parent).toContain("useFeeStructureMeta");
    expect(parent).toContain("feeTermLabelLong(fee.term, feeMeta)");
    const token = read("src/components/applicant/TokenFeePanel.tsx");
    expect(token).not.toContain('replace("year_", "Year ")');
    expect(token).not.toContain("First-Year Amount Due");
    expect(token).toContain("feeTermLabel(r.term, feeMeta)");
  });
});
