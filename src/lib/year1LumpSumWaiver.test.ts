import { describe, expect, it } from "vitest";
import {
  allocationsCoverYear1Tuition,
  buildYear1LumpSumOffer,
  isUniformFeeHead,
  isYear1TuitionHead,
  lumpSumPctFromPolicy,
  scaleYear1AllocationsForLumpSum,
  year1LumpSumNoticeVisible,
} from "./year1LumpSumWaiver";

const tuition = {
  id: "11111111-1111-1111-1111-111111111111",
  term: "year_1",
  fee_code: "TUITION",
  fee_code_name: "Year 1 Tuition (to college)",
  category: "tuition",
  balance: 52_000,
};

const uniform = {
  id: "22222222-2222-2222-2222-222222222222",
  term: "year_1",
  fee_code: "UNIFORM",
  fee_code_name: "Uniform Fee",
  category: "other",
  balance: 6_000,
};

const year2 = {
  id: "33333333-3333-3333-3333-333333333333",
  term: "year_2",
  fee_code: "TUITION",
  fee_code_name: "Year 2 Tuition Fee",
  category: "tuition",
  balance: 94_760,
};

const abvmu = {
  id: "abvmu-11111111-1111-1111-1111-111111111111",
  term: "year_1",
  fee_code: "ABVMU-DEP",
  fee_code_name: "ABVMU Deposit (Year 1)",
  category: "tuition",
  balance: 40_000,
};

describe("year-1 lump-sum waiver", () => {
  it("is 5% of remaining Year-1 tuition only — never uniform or later years", () => {
    const offer = buildYear1LumpSumOffer([tuition, uniform, year2, abvmu], { lumpSumPct: 5 });
    expect(isYear1TuitionHead(tuition)).toBe(true);
    expect(isUniformFeeHead(uniform)).toBe(true);
    expect(isYear1TuitionHead(uniform)).toBe(false);
    expect(offer).toMatchObject({
      eligible: true,
      remaining: 52_000,
      discount: 2_600,
      amountDue: 49_400,
      feeIds: [tuition.id],
    });
  });

  it("treats leftover below the ABVMU deposit as college-cleared (no offer)", () => {
    const unsplit = { ...tuition, fee_code_name: "Year 1 Tuition", balance: 38_600 };
    expect(buildYear1LumpSumOffer([unsplit], {
      lumpSumPct: 5,
      abvmuCollegeDeduction: 40_000,
    }).eligible).toBe(false);
  });

  it("subtracts the ABVMU university deposit from unsplit Year-1 tuition", () => {
    const unsplit = { ...tuition, fee_code_name: "Year 1 Tuition", balance: 92_000 };
    const offer = buildYear1LumpSumOffer([unsplit], {
      lumpSumPct: 5,
      abvmuCollegeDeduction: 40_000,
    });
    expect(offer.remaining).toBe(52_000);
    expect(offer.discount).toBe(2_600);
    expect(offer.amountDue).toBe(49_400);
  });

  it("matches TUITION-Y1 even when category is missing", () => {
    expect(isYear1TuitionHead({
      id: "y1",
      term: "year_1",
      fee_code: "TUITION-Y1",
      fee_code_name: "Year 1 Tuition (to college)",
      category: null,
      balance: 52_000,
    })).toBe(true);
  });

  it("hides the offer when policy is 0% or Year 1 tuition is cleared", () => {
    expect(buildYear1LumpSumOffer([tuition], { lumpSumPct: 0 }).eligible).toBe(false);
    const cleared = buildYear1LumpSumOffer([{ ...tuition, balance: 0 }], { lumpSumPct: 5 });
    expect(cleared).toMatchObject({ eligible: false, alreadyAvailed: true });
    expect(year1LumpSumNoticeVisible(cleared)).toBe(true);
    expect(year1LumpSumNoticeVisible(buildYear1LumpSumOffer([tuition], { lumpSumPct: 0 }))).toBe(false);
  });

  it("reads lump_sum_first_year_waiver_pct from structure policy", () => {
    expect(lumpSumPctFromPolicy({ lump_sum_first_year_waiver_pct: 5 })).toBe(5);
    expect(lumpSumPctFromPolicy({ lump_sum_first_year_waiver_pct: 0 })).toBe(0);
    expect(lumpSumPctFromPolicy(null)).toBe(5);
  });

  it("scales Year-1 allocations to the discounted cash amount and leaves uniform alone", () => {
    const offer = buildYear1LumpSumOffer([tuition, uniform], { lumpSumPct: 5 });
    const allocs = [
      { fee_ledger_id: tuition.id, amount: 52_000, label: "tuition" },
      { fee_ledger_id: uniform.id, amount: 6_000, label: "uniform" },
    ];
    expect(allocationsCoverYear1Tuition(allocs, offer)).toBe(true);
    expect(scaleYear1AllocationsForLumpSum(allocs, offer)).toEqual([
      { fee_ledger_id: tuition.id, amount: 49_400, label: "tuition" },
      { fee_ledger_id: uniform.id, amount: 6_000, label: "uniform" },
    ]);
  });
});
