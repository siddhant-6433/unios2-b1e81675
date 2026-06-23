import { describe, expect, it } from "vitest";
import { chooseOfferSessionId, feeBackedSessionIds, feeStructureHasYearWiseItems } from "./offerSessions";

describe("offer session selection", () => {
  it("detects fee structures that have year-wise fee items", () => {
    expect(feeStructureHasYearWiseItems({
      session_id: "s1",
      fee_structure_items: [{ term: "year_1", amount: 100000 }],
    })).toBe(true);

    expect(feeStructureHasYearWiseItems({
      session_id: "s1",
      fee_structure_items: [{ term: "application_fee", amount: 1000 }],
    })).toBe(false);
  });

  it("deduplicates sessions with usable year-wise fee structures", () => {
    expect(feeBackedSessionIds([
      { session_id: "2026", fee_structure_items: [{ term: "year_1", amount: 1 }] },
      { session_id: "2026", fee_structure_items: [{ term: "year_2", amount: 1 }] },
      { session_id: "2027", fee_structure_items: [{ term: "application_fee", amount: 1 }] },
    ])).toEqual(["2026"]);
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
