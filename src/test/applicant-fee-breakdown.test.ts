import { describe, expect, it } from "vitest";
import { buildApplicantFeeBreakdownRows } from "@/components/applicant/feeBreakdown";

describe("applicant fee breakdown", () => {
  it("reconstructs gross fees from net year fees and does not subtract offer waivers twice", () => {
    const rows = buildApplicantFeeBreakdownRows({
      yearFeesNet: {
        year_1: 100,
        year_2: 70_000,
      },
      offerWaivers: [
        { term: "year_1", amount: 129_000 },
        { term: "year_2", amount: 30_000 },
      ],
      scholarshipAmount: 0,
      feeStatus: {
        first_year_fee: 129_100,
        post_scholarship_year_1: 100,
      },
    });

    expect(rows).toEqual([
      {
        term: "year_1",
        raw: 129_100,
        sch: 0,
        waivers: 129_000,
        totalDeduction: 129_000,
        net: 100,
      },
      {
        term: "year_2",
        raw: 100_000,
        sch: 0,
        waivers: 30_000,
        totalDeduction: 30_000,
        net: 70_000,
      },
    ]);
  });

  it("keeps legacy scholarship_amount as a Year-1 fallback when there are no offer waivers", () => {
    const [row] = buildApplicantFeeBreakdownRows({
      yearFeesNet: { year_1: 130_000 },
      offerWaivers: [],
      scholarshipAmount: 20_000,
      feeStatus: {
        first_year_fee: 130_000,
        post_scholarship_year_1: 110_000,
      },
    });

    expect(row).toMatchObject({
      raw: 130_000,
      sch: 20_000,
      waivers: 0,
      totalDeduction: 20_000,
      net: 110_000,
    });
  });
});
