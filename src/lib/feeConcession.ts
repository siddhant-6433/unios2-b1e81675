/**
 * Fee-concession maths for the approval surfaces.
 *
 * A concession is either a flat rupee amount or a percentage of the ledger
 * head it is attached to. Approvers need to see, on the ledger item itself,
 * what is already waived, what this request adds, and the net payable after
 * the waiver — not just the raw "10%" or "5000".
 *
 * Kept pure so the sums can be unit-tested independently of the Inbox render.
 */

/** Rupee value of a flat/percentage concession against a ledger head. */
export function effectiveConcessionAmount(
  type: string | null | undefined,
  value: number | null | undefined,
  total: number | null | undefined,
): number {
  const v = Number(value) || 0;
  const t = Math.max(0, Number(total) || 0);
  if (!(v > 0)) return 0;
  return type === "percentage" ? Math.round((t * v) / 100) : Math.round(v);
}

export interface ConcessionLedgerSummary {
  /** Ledger head amount before any waiver. */
  total: number;
  /** Concession already approved on this ledger row (offer waivers + prior concessions). */
  existing: number;
  /** Rupee value of the concession under approval. */
  requested: number;
  /** Ledger head less existing and requested waiver, never below zero. */
  netAfterWaiver: number;
  /** Amount already collected against the head. */
  paid: number;
  /** What would still be owed once this waiver is applied. */
  projectedBalance: number;
}

export function summarizeConcessionLedger(input: {
  total: number | null | undefined;
  existing?: number | null;
  type: string | null | undefined;
  value: number | null | undefined;
  paid?: number | null;
}): ConcessionLedgerSummary {
  const total = Math.max(0, Number(input.total) || 0);
  // A head can't carry more waiver than its own amount.
  const existing = Math.min(Math.max(0, Number(input.existing) || 0), total);
  const requested = effectiveConcessionAmount(input.type, input.value, total);
  const netAfterWaiver = Math.max(0, total - existing - requested);
  const paid = Math.max(0, Number(input.paid) || 0);
  return {
    total,
    existing,
    requested,
    netAfterWaiver,
    paid,
    projectedBalance: Math.max(0, netAfterWaiver - paid),
  };
}
