export type OfferWaiver = { term: string; amount: number };

export type FeeBreakdownStatus = {
  first_year_fee: number;
  post_scholarship_year_1?: number | null;
};

export type FeeBreakdownRow = {
  term: string;
  raw: number;
  sch: number;
  waivers: number;
  totalDeduction: number;
  net: number;
};

const clampMoney = (value: number) => Math.max(0, Number(value) || 0);

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
