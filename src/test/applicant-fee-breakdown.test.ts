import { describe, expect, it } from "vitest";
import {
  buildApplicantFeeBreakdownRows,
  buildApplicantOneTimePaymentOptions,
  resolvePaidTowardCourse,
} from "@/components/applicant/feeBreakdown";

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

  it("calculates one-time payment options on post-waiver net fees", () => {
    const rows = buildApplicantFeeBreakdownRows({
      yearFeesNet: {
        year_1: 75_000,
        year_2: 75_000,
        year_3: 75_000,
        year_4: 75_000,
      },
      offerWaivers: [
        { term: "year_1", amount: 17_000 },
        { term: "year_2", amount: 19_760 },
        { term: "year_3", amount: 22_603 },
        { term: "year_4", amount: 25_531 },
      ],
      scholarshipAmount: 0,
      feeStatus: {
        first_year_fee: 92_000,
        post_scholarship_year_1: 75_000,
      },
    });

    const options = buildApplicantOneTimePaymentOptions({
      rows,
      paidTowardCourse: 37_500,
      lumpSumPct: 5,
      multiYearPct: 2.5,
      includeMultiYearWaiver: true,
    });

    expect(options).toMatchObject({
      year1NetFee: 75_000,
      totalNetFee: 300_000,
      year1Discount: 3_750,
      fullCourseDiscount: 20_625,
      year1AmountDue: 33_750,
      fullCourseAmountDue: 241_875,
      uniformFee: 0,
    });
  });

  it("adds uniform to one-time dues and does not apply the lump-sum waiver to it", () => {
    const rows = buildApplicantFeeBreakdownRows({
      yearFeesNet: { year_1: 92_000, year_2: 92_000 },
      offerWaivers: [],
      scholarshipAmount: 0,
      feeStatus: { first_year_fee: 92_000, post_scholarship_year_1: 92_000 },
    });

    const options = buildApplicantOneTimePaymentOptions({
      rows,
      paidTowardCourse: 0,
      lumpSumPct: 5,
      multiYearPct: 0,
      includeMultiYearWaiver: false,
      uniformFee: 6_000,
    });

    expect(options.year1Discount).toBe(4_600);
    expect(options.uniformFee).toBe(6_000);
    expect(options.year1AmountDue).toBe(93_400);
    expect(options.fullCourseAmountDue).toBe(180_800);
  });

  it("keeps an approved ABVMU credit off the 5% base and still adds uniform", () => {
    const rows = buildApplicantFeeBreakdownRows({
      yearFeesNet: { year_1: 92_000 },
      offerWaivers: [],
      scholarshipAmount: 0,
      feeStatus: { first_year_fee: 92_000, post_scholarship_year_1: 92_000 },
    });

    const options = buildApplicantOneTimePaymentOptions({
      rows,
      paidTowardCourse: 40_000,
      lumpSumPct: 5,
      multiYearPct: 0,
      includeMultiYearWaiver: false,
      uniformFee: 6_000,
    });

    // 5% of 92,000 tuition = 4,600. Uniform 6,000 is added after, not discounted.
    expect(options.year1Discount).toBe(4_600);
    expect(options.year1AmountDue).toBe(53_400);
  });

  it("does not change one-time dues when there is no uniform fee", () => {
    const rows = buildApplicantFeeBreakdownRows({
      yearFeesNet: { year_1: 92_000 },
      offerWaivers: [],
      scholarshipAmount: 0,
      feeStatus: { first_year_fee: 92_000, post_scholarship_year_1: 92_000 },
    });

    const withoutUniform = buildApplicantOneTimePaymentOptions({
      rows,
      paidTowardCourse: 0,
      lumpSumPct: 5,
      multiYearPct: 0,
      includeMultiYearWaiver: false,
    });
    expect(withoutUniform.year1AmountDue).toBe(87_400);
    expect(withoutUniform.uniformFee).toBe(0);
  });

  it("does not count application or registration fee as course-paid fallback", () => {
    expect(resolvePaidTowardCourse({
      total_paid: 11_000,
      application_paid: 1_000,
      registration_paid: 5_000,
    })).toBe(5_000);
  });

  it("prefers authoritative paid_toward_course when present", () => {
    expect(resolvePaidTowardCourse({
      paid_toward_course: 4_000,
      total_paid: 10_000,
      application_paid: 1_000,
      registration_paid: 5_000,
    })).toBe(4_000);
  });
});
