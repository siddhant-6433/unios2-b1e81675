import { describe, expect, it } from "vitest";
import { collectOfferFeeTermTotals, isBaseOfferProgrammeFeeItem } from "./offerFeeTerms";

describe("offer programme fee — base vs optional items", () => {
  // Real Grade V (Beacon) new_admission structure: each quarter lists tuition +
  // every boarding tier + every transport tier; admission lists admission fee +
  // boarder-only security deposit. Only the mandatory core is the base fee.
  const gradeV = [
    { term: "admission", amount: 20000, fee_codes: { code: "NB-ADM", category: "enrollment" } },
    { term: "admission", amount: 20000, fee_codes: { code: "NB-SEC", category: "enrollment" } }, // boarders only
    { term: "q1", amount: 14001, fee_codes: { code: "NB-CPY", category: "tuition" } },
    { term: "q1", amount: 78000, fee_codes: { code: "NB-IBA", category: "hostel" } },
    { term: "q1", amount: 56184, fee_codes: { code: "NB-CBA", category: "hostel" } },
    { term: "q1", amount: 50184, fee_codes: { code: "NB-NAC", category: "hostel" } },
    { term: "q1", amount: 12000, fee_codes: { code: "NB-DBA", category: "hostel" } },
    { term: "q1", amount: 10500, fee_codes: { code: "NB-TR3", category: "transport" } },
    { term: "q1", amount: 7500, fee_codes: { code: "NB-TR2", category: "transport" } },
    { term: "q1", amount: 5400, fee_codes: { code: "NB-TR1", category: "transport" } },
  ];

  it("excludes hostel, transport and boarder-only security deposit", () => {
    expect(isBaseOfferProgrammeFeeItem({ fee_codes: { code: "NB-CPY", category: "tuition" } })).toBe(true);
    expect(isBaseOfferProgrammeFeeItem({ fee_codes: { code: "NB-ADM", category: "enrollment" } })).toBe(true);
    expect(isBaseOfferProgrammeFeeItem({ fee_codes: { code: "NB-SEC", category: "enrollment" } })).toBe(false);
    expect(isBaseOfferProgrammeFeeItem({ fee_codes: { code: "NB-IBA", category: "hostel" } })).toBe(false);
    expect(isBaseOfferProgrammeFeeItem({ fee_codes: { code: "NB-TR1", category: "transport" } })).toBe(false);
  });

  it("collects only the base programme fee per term", () => {
    const totals = collectOfferFeeTermTotals(gradeV);
    expect(totals).toEqual([
      { term: "admission", total: 20000 },
      { term: "q1", total: 14001 },
    ]);
  });

  it("still sums plain university year fees (no categories)", () => {
    const totals = collectOfferFeeTermTotals([
      { term: "year_1", amount: 100000 },
      { term: "year_1", amount: 5000 },
      { term: "year_2", amount: 100000 },
    ]);
    expect(totals).toEqual([
      { term: "year_1", total: 105000 },
      { term: "year_2", total: 100000 },
    ]);
  });

  // Full quarter of Grade V for mode-based selection tests.
  const q1 = [
    { term: "q1", amount: 14001, fee_codes: { code: "NB-CPY", category: "tuition" } },
    { term: "q1", amount: 78000, fee_codes: { code: "NB-IBA", category: "hostel" } },
    { term: "q1", amount: 56184, fee_codes: { code: "NB-CBA", category: "hostel" } },
    { term: "q1", amount: 50184, fee_codes: { code: "NB-NAC", category: "hostel" } },
    { term: "q1", amount: 12000, fee_codes: { code: "NB-DBA", category: "hostel" } },
    { term: "q1", amount: 10500, fee_codes: { code: "NB-TR3", category: "transport" } },
    { term: "q1", amount: 7500, fee_codes: { code: "NB-TR2", category: "transport" } },
    { term: "q1", amount: 5400, fee_codes: { code: "NB-TR1", category: "transport" } },
    { term: "admission", amount: 20000, fee_codes: { code: "NB-ADM", category: "enrollment" } },
    { term: "admission", amount: 20000, fee_codes: { code: "NB-SEC", category: "enrollment" } },
  ];

  it("day scholar with transport zone 2 → tuition + one transport tier", () => {
    const totals = collectOfferFeeTermTotals(q1, { studentType: "day_scholar", transportZone: "zone_2" });
    expect(totals).toEqual([
      { term: "admission", total: 20000 },
      { term: "q1", total: 14001 + 7500 },
    ]);
  });

  it("day boarder → tuition + day-boarding only", () => {
    const totals = collectOfferFeeTermTotals(q1, { studentType: "day_boarder" });
    expect(totals).toEqual([
      { term: "admission", total: 20000 },
      { term: "q1", total: 14001 + 12000 },
    ]);
  });

  it("boarder AC-individual + zone 1 → deposit on its own line, not folded into admission", () => {
    const totals = collectOfferFeeTermTotals(q1, {
      studentType: "boarder",
      hostelType: "ac_individual",
      transportZone: "zone_1",
    });
    expect(totals).toEqual([
      { term: "admission", total: 20000 },        // admission fee only
      { term: "security_deposit", total: 20000 }, // refundable deposit, separate line
      { term: "q1", total: 14001 + 78000 + 5400 },
    ]);
  });
});
