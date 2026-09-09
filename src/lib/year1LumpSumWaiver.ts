/** Year-1 one-time tuition waiver (lump_sum_first_year_waiver_pct, typically 5%). Never uniform. */

export type Year1LumpSumRow = {
  id: string;
  term?: string | null;
  fee_code?: string | null;
  fee_code_name?: string | null;
  category?: string | null;
  balance: number;
};

export type Year1LumpSumOffer = {
  eligible: boolean;
  alreadyAvailed: boolean;
  pct: number;
  remaining: number;
  discount: number;
  amountDue: number;
  feeIds: string[];
};

const clampMoney = (value: number) => Math.max(0, Number(value) || 0);
const roundMoney = (value: number) => Math.round(clampMoney(value));

const blobOf = (row: Year1LumpSumRow) =>
  `${row.fee_code || ""} ${row.fee_code_name || ""} ${row.category || ""}`.toLowerCase();

export function isUniformFeeHead(row: Year1LumpSumRow): boolean {
  return /uniform/.test(blobOf(row));
}

export function isAbvmuDepositHead(row: Year1LumpSumRow): boolean {
  if (String(row.id || "").startsWith("abvmu-")) return true;
  const code = String(row.fee_code || "");
  if (/^ABVMU-DEP$/i.test(code)) return true;
  const blob = blobOf(row);
  return /abvmu/.test(blob) && /deposit/.test(blob);
}

export function isYear1TuitionHead(row: Year1LumpSumRow): boolean {
  if (String(row.term || "").toLowerCase() !== "year_1") return false;
  if (isUniformFeeHead(row) || isAbvmuDepositHead(row)) return false;
  const cat = String(row.category || "").toLowerCase();
  if (cat && cat !== "tuition") return false;
  const blob = blobOf(row);
  if (/hostel|transport|exam|library/.test(blob) && !/tuition/.test(blob)) return false;
  return true;
}

export function lumpSumPctFromPolicy(policy: unknown, fallback = 5): number {
  const raw = policy && typeof policy === "object"
    ? Number((policy as { lump_sum_first_year_waiver_pct?: unknown }).lump_sum_first_year_waiver_pct)
    : NaN;
  if (!Number.isFinite(raw)) return fallback;
  return Math.max(0, raw);
}

export function allocationsCoverYear1Tuition(
  allocations: Array<{ fee_ledger_id?: string; amount: number }>,
  offer: Year1LumpSumOffer,
): boolean {
  if (!offer.eligible || offer.feeIds.length === 0) return false;
  const byId = new Map(allocations.map((a) => [a.fee_ledger_id, Number(a.amount) || 0]));
  let covered = 0;
  for (const id of offer.feeIds) {
    const amt = byId.get(id) || 0;
    if (amt <= 0) return false;
    covered += amt;
  }
  return Math.abs(covered - offer.remaining) < 1;
}

export function scaleYear1AllocationsForLumpSum<T extends { fee_ledger_id?: string; amount: number }>(
  allocations: T[],
  offer: Year1LumpSumOffer,
): T[] {
  if (!offer.eligible || offer.remaining <= 0) return allocations;
  const year1 = new Set(offer.feeIds);
  let allocated = 0;
  const year1Rows = allocations.filter((a) => a.fee_ledger_id && year1.has(a.fee_ledger_id));
  return allocations.map((a, i) => {
    if (!a.fee_ledger_id || !year1.has(a.fee_ledger_id)) return a;
    const isLast = year1Rows[year1Rows.length - 1] === a || i === allocations.length - 1;
    const share = isLast
      ? offer.amountDue - allocated
      : roundMoney((a.amount / offer.remaining) * offer.amountDue);
    allocated += share;
    return { ...a, amount: Math.max(0, share) };
  });
}

export function buildYear1LumpSumOffer(
  rows: Year1LumpSumRow[],
  opts: { lumpSumPct: number; abvmuCollegeDeduction?: number } = { lumpSumPct: 5 },
): Year1LumpSumOffer {
  const pct = clampMoney(opts.lumpSumPct);
  const tuition = rows.filter(isYear1TuitionHead);
  const feeIds = tuition.map((r) => r.id).filter((id) => !String(id).startsWith("abvmu-"));
  const rawRemaining = tuition.reduce((sum, r) => sum + clampMoney(r.balance), 0);
  const dep = clampMoney(opts.abvmuCollegeDeduction || 0);
  // If the university deposit is still sitting in the Year-1 tuition row,
  // remaining < deposit means college tuition is already covered.
  const remaining = dep > 0 && rawRemaining + 0.01 < dep
    ? 0
    : Math.max(0, roundMoney(rawRemaining - dep));
  const discount = remaining > 0 && pct > 0 ? roundMoney(remaining * (pct / 100)) : 0;
  const amountDue = Math.max(0, remaining - discount);
  const alreadyAvailed = remaining <= 0;
  const eligible = pct > 0 && remaining > 0 && discount > 0 && amountDue > 0 && feeIds.length > 0;

  return {
    eligible,
    alreadyAvailed,
    pct,
    remaining,
    discount,
    amountDue,
    feeIds,
  };
}
