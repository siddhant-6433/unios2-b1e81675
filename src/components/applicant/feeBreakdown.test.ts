import { describe, expect, it } from "vitest";
import {
  buildApplicantFeeBreakdownRows,
  buildApplicantOneTimePaymentOptions,
  hasApplicantOneTimePaymentOptions,
} from "./feeBreakdown";

describe("applicant one-time payment options", () => {
  it("keeps full first-year and full-course options visible when waiver policy is 0%", () => {
    const rows = buildApplicantFeeBreakdownRows({
      yearFeesNet: {
        year_1: 153_000,
        year_2: 153_000,
        year_3: 153_000,
        year_4: 153_000,
      },
      offerWaivers: [],
      scholarshipAmount: 0,
      feeStatus: {
        first_year_fee: 153_000,
        post_scholarship_year_1: 153_000,
      },
    });

    const options = buildApplicantOneTimePaymentOptions({
      rows,
      paidTowardCourse: 38_250,
      lumpSumPct: 0,
      multiYearPct: 0,
      includeMultiYearWaiver: true,
    });

    expect(hasApplicantOneTimePaymentOptions(options)).toBe(true);
    expect(options).toMatchObject({
      year1NetFee: 153_000,
      totalNetFee: 612_000,
      year1Discount: 0,
      fullCourseDiscount: 0,
      year1AmountDue: 114_750,
      fullCourseAmountDue: 573_750,
    });
  });
});
