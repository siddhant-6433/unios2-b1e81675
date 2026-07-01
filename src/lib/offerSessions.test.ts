import { describe, expect, it } from "vitest";
import { collectOfferFeeTermTotals, firstOfferFeeTerm } from "./offerFeeTerms";
import { chooseOfferSessionId, feeBackedSessionIds, feeStructureHasOfferFeeItems } from "./offerSessions";

describe("offer session selection", () => {
  it("detects fee structures that have offer programme fee items", () => {
    expect(feeStructureHasOfferFeeItems({
      session_id: "s1",
      fee_structure_items: [{ term: "year_1", amount: 100000 }],
    })).toBe(true);

    expect(feeStructureHasOfferFeeItems({
      session_id: "s1",
      fee_structure_items: [
        { term: "admission", amount: 20000 },
        { term: "q1", amount: 6930 },
      ],
    })).toBe(true);

    expect(feeStructureHasOfferFeeItems({
      session_id: "s1",
      fee_structure_items: [{ term: "application_fee", amount: 1000 }],
    })).toBe(false);
  });

  it("groups school fee periods for offer totals", () => {
    const totals = collectOfferFeeTermTotals([
      { term: "q2", amount: 6930 },
      { term: "application_fee", amount: 500 },
      { term: "admission", amount: 20000 },
      { term: "q1", amount: 6930 },
      { term: "q1", amount: 70 },
    ]);

    expect(totals).toEqual([
      { term: "admission", total: 20000 },
      { term: "q1", total: 7000 },
      { term: "q2", total: 6930 },
    ]);
    expect(firstOfferFeeTerm(totals)).toBe("admission");
  });

  it("deduplicates sessions with usable offer fee structures", () => {
    expect(feeBackedSessionIds([
      { session_id: "2026", fee_structure_items: [{ term: "year_1", amount: 1 }] },
      { session_id: "2026", fee_structure_items: [{ term: "year_2", amount: 1 }] },
      { session_id: "2027", fee_structure_items: [{ term: "q1", amount: 1 }] },
      { session_id: "2028", fee_structure_items: [{ term: "application_fee", amount: 1 }] },
    ])).toEqual(["2026", "2027"]);
  });

  it("prefers an active fee-backed session over a newer active session with no fees", () => {
    const sessions = [
      { id: "2027", name: "2027-28", is_active: true, has_fee_structure: false },
      { id: "2026", name: "2026-27", is_active: true, has_fee_structure: true },
    ];

    expect(chooseOfferSessionId(sessions, "")).toBe("2026");
  });

  it("moves an invalid current selection to a fee-backed session", () => {
    const sessions = [
      { id: "2027", name: "2027-28", is_active: true, has_fee_structure: false },
      { id: "2026", name: "2026-27", is_active: true, has_fee_structure: true },
    ];

    expect(chooseOfferSessionId(sessions, "2027")).toBe("2026");
  });

  it("keeps the current selection when it already has fees", () => {
    const sessions = [
      { id: "2027", name: "2027-28", is_active: true, has_fee_structure: true },
      { id: "2026", name: "2026-27", is_active: true, has_fee_structure: true },
    ];

    expect(chooseOfferSessionId(sessions, "2027")).toBe("2027");
  });
});
