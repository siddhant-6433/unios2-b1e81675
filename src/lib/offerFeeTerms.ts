export interface OfferFeeItemLike {
  term?: string | null;
  amount?: number | string | null;
}

export interface OfferFeeTermTotal {
  term: string;
  total: number;
}

const SCHOOL_OFFER_TERM_ORDER = ["admission", "q1", "q2", "q3", "q4"];

export function isOfferProgrammeFeeTerm(term: string | null | undefined): boolean {
  const normalized = String(term || "").trim().toLowerCase();
  return /^year_\d+$/.test(normalized) || SCHOOL_OFFER_TERM_ORDER.includes(normalized);
}

export function offerFeeTermRank(term: string): number {
  const normalized = term.trim().toLowerCase();
  const yearMatch = normalized.match(/^year_(\d+)$/);
  if (yearMatch) return Number(yearMatch[1]);

  const schoolIndex = SCHOOL_OFFER_TERM_ORDER.indexOf(normalized);
  if (schoolIndex >= 0) return 100 + schoolIndex;

  return 1_000;
}

export function collectOfferFeeTermTotals(items: OfferFeeItemLike[] | null | undefined): OfferFeeTermTotal[] {
  const byTerm = new Map<string, number>();
  for (const item of items || []) {
    const term = String(item?.term || "").trim().toLowerCase();
    const amount = Number(item?.amount || 0);
    if (!isOfferProgrammeFeeTerm(term) || !Number.isFinite(amount) || amount <= 0) continue;
    byTerm.set(term, (byTerm.get(term) || 0) + amount);
  }

  return Array.from(byTerm.entries())
    .sort(([a], [b]) => offerFeeTermRank(a) - offerFeeTermRank(b) || a.localeCompare(b))
    .map(([term, total]) => ({ term, total }));
}

export function firstOfferFeeTerm(totals: OfferFeeTermTotal[]): string {
  return totals.find((item) => item.term === "year_1")?.term || totals[0]?.term || "year_1";
}
