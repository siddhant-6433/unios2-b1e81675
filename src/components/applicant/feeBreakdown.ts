export type OfferWaiver = { term: string; amount: number };

export type FeeBreakdownStatus = {
  first_year_fee: number;
  post_scholarship_year_1?: number | null;
};

export type CoursePaymentStatus = {
  paid_toward_course?: number | null;
  total_paid?: number | null;
  application_paid?: number | null;
  registration_paid?: number | null;
};

export type FeeBreakdownRow = {
  term: string;
  raw: number;
  sch: number;
  waivers: number;
  totalDeduction: number;
  net: number;
};

export type OneTimePaymentOptions = {
  year1NetFee: number;
  totalNetFee: number;
  additionalYearsNetFee: number;
  paidTowardCourse: number;
  year1Discount: number;
  fullCourseDiscount: number;
  fullCourseAdditionalDiscount: number;
  year1AmountDue: number;
  fullCourseAmountDue: number;
};

const clampMoney = (value: number) => Math.max(0, Number(value) || 0);
const roundMoney = (value: number) => Math.round(clampMoney(value));

export function resolvePaidTowardCourse(status: CoursePaymentStatus): number {
  if (status.paid_toward_course != null) {
    return clampMoney(status.paid_toward_course);
  }

  return clampMoney(
    clampMoney(status.total_paid || 0) -
      clampMoney(status.application_paid || 0) -
      clampMoney(status.registration_paid || 0),
  );
}

export function buildApplicantFeeBreakdownRows({
  yearFeesNet,
  offerWaivers,
  scholarshipAmount,
  feeStatus,
}: {
  yearFeesNet: Record<string, number>;
  offerWaivers: OfferWaiver[];
  scholarshipAmount: number;
  feeStatus: FeeBreakdownStatus;
}): FeeBreakdownRow[] {
  return Object.keys(yearFeesNet)
    .filter((key) => key.startsWith("year_"))
    .sort()
    .map((term) => {
      const netAfterOfferWaivers = clampMoney(yearFeesNet[term]);
      const waivers = offerWaivers
        .filter((w) => w.term === term)
        .reduce((sum, w) => sum + clampMoney(w.amount), 0);

      // New offers store discounts in offer_waivers. Legacy offers used
      // offer.scholarship_amount without offer_waivers, so keep that as a
      // Year-1-only fallback to avoid showing the same discount twice.
      const sch = term === "year_1" && waivers === 0 ? clampMoney(scholarshipAmount) : 0;
      const raw = term === "year_1"
        ? clampMoney(feeStatus.first_year_fee || netAfterOfferWaivers + waivers + sch)
        : netAfterOfferWaivers + waivers;
      const net = term === "year_1"
        ? clampMoney(feeStatus.post_scholarship_year_1 ?? raw - sch - waivers)
        : netAfterOfferWaivers;

      return {
        term,
        raw,
        sch,
        waivers,
        totalDeduction: Math.max(0, raw - net),
        net,
      };
    });
}

export function buildApplicantOneTimePaymentOptions({
  rows,
  paidTowardCourse,
  lumpSumPct,
  multiYearPct,
  includeMultiYearWaiver,
}: {
  rows: FeeBreakdownRow[];
  paidTowardCourse: number;
  lumpSumPct: number;
  multiYearPct: number;
  includeMultiYearWaiver: boolean;
}): OneTimePaymentOptions {
  const year1NetFee = clampMoney(rows.find((row) => row.term === "year_1")?.net || 0);
  const additionalYearsNetFee = rows
    .filter((row) => row.term !== "year_1")
    .reduce((sum, row) => sum + clampMoney(row.net), 0);
  const totalNetFee = year1NetFee + additionalYearsNetFee;
  const paid = clampMoney(paidTowardCourse);
  const lumpPct = clampMoney(lumpSumPct) / 100;
  const additionalPct = (clampMoney(lumpSumPct) + (includeMultiYearWaiver ? clampMoney(multiYearPct) : 0)) / 100;
  const year1Discount = roundMoney(year1NetFee * lumpPct);
  const fullCourseAdditionalDiscount = roundMoney(additionalYearsNetFee * additionalPct);
  const fullCourseDiscount = year1Discount + fullCourseAdditionalDiscount;

  return {
    year1NetFee,
    totalNetFee,
    additionalYearsNetFee,
    paidTowardCourse: paid,
    year1Discount,
    fullCourseDiscount,
    fullCourseAdditionalDiscount,
    year1AmountDue: Math.max(0, roundMoney(year1NetFee - paid - year1Discount)),
    fullCourseAmountDue: Math.max(0, roundMoney(totalNetFee - paid - fullCourseDiscount)),
  };
}
