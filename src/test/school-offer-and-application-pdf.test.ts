import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { collectOfferFeeTermTotals, firstOfferFeeTerm } from "@/lib/offerFeeTerms";
import { feeBackedSessionIds } from "@/lib/offerSessions";

const offerDialog = readFileSync("src/components/admissions/OfferLetterDialog.tsx", "utf8");
const offerFunction = readFileSync("supabase/functions/generate-offer-letter/index.ts", "utf8");
const applyPortal = readFileSync("src/pages/ApplyPortal.tsx", "utf8");

describe("school offer letter and application PDF recovery", () => {
  it("treats school admission and quarterly rows as offer programme fees", () => {
    const rows = [
      { term: "application_fee", amount: 500 },
      { term: "q2", amount: 6_930 },
      { term: "admission", amount: 20_000 },
      { term: "q1", amount: 6_930 },
      { term: "q4", amount: 6_930 },
      { term: "q3", amount: 6_930 },
    ];

    expect(collectOfferFeeTermTotals(rows)).toEqual([
      { term: "admission", total: 20_000 },
      { term: "q1", total: 6_930 },
      { term: "q2", total: 6_930 },
      { term: "q3", total: 6_930 },
      { term: "q4", total: 6_930 },
    ]);
    expect(firstOfferFeeTerm(collectOfferFeeTermTotals(rows))).toBe("admission");
    expect(feeBackedSessionIds([{ session_id: "2026", fee_structure_items: rows }])).toEqual(["2026"]);
  });

  it("uses shared offer fee term grouping in the dialog and edge PDF generator", () => {
    // Variable names moved on (rawFeeItems / payable); what matters is the
    // dialog grouping through the shared helpers rather than its own logic.
    expect(offerDialog).toContain("collectOfferFeeTermTotals(rawFeeItems");
    expect(offerDialog).toContain("firstOfferFeeTerm(");
    expect(offerDialog).toContain('from "@/lib/offerFeeTerms"');
    expect(offerFunction).toContain('SCHOOL_OFFER_TERM_ORDER = ["admission", "q1", "q2", "q3", "q4"]');
    expect(offerFunction).toContain("isOfferProgrammeFeeTerm(term)");
    expect(offerFunction).not.toContain("if (!it.term?.startsWith(\"year_\")) continue");
  });

  it("uses applications.application_id for offer PDF badges instead of lead UUID identifiers", () => {
    expect(offerFunction).toContain("function isUuidLike");
    expect(offerFunction).toContain("let applicationId: string | null = null");
    expect(offerFunction).toContain('.from("applications")');
    expect(offerFunction).toContain('.eq("lead_id", offer.lead_id)');
    expect(offerFunction).toContain('.eq("id", lead.application_id)');
    expect(offerFunction).toContain("appId: opts.applicationId || publicApplicationRef(opts.lead.application_id) || opts.lead.pre_admission_no");
    expect(offerFunction).toContain('value: opts.applicationId || publicApplicationRef(opts.lead.application_id) || opts.lead.pre_admission_no || "-"');
    expect(offerFunction).not.toContain("let applicationId: string | null = lead?.application_id || null");
  });

  it("regenerates missing application PDFs in submitted applicant view", () => {
    expect(applyPortal).toContain("const ensureApplicationPdf = async");
    expect(applyPortal).toContain('supabase.functions.invoke("generate-application-form"');
    expect(applyPortal).toContain("!app.form_pdf_url && generatingApplicationPdf");
    expect(applyPortal).toContain("Preparing PDF");
  });
});
