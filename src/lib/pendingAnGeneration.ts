export type PendingAnDocState = "verified" | "rejected" | "pending" | "missing";

export interface PendingAnDocStatus {
  complete?: boolean;
  held?: boolean;
  required_total?: number;
  verified?: number;
  rejected?: number;
  pending?: number;
  missing?: number;
  docs?: { key: string; label: string; state: PendingAnDocState }[];
}

/** Labels for the Pending AN Generation queue when the cached status is missing. */
export function pendingAnDocSummary(ds: PendingAnDocStatus | null | undefined): {
  ratio: string;
  caption: string;
  hasBreakdown: boolean;
} {
  const docs = ds?.docs || [];
  const hasBreakdown = docs.length > 0 || (ds?.required_total ?? 0) > 0;
  if (!ds || !hasBreakdown) {
    return { ratio: "—", caption: "Verification status unavailable", hasBreakdown: false };
  }
  const outstanding = (ds.missing || 0) + (ds.rejected || 0) + (ds.pending || 0);
  return {
    ratio: `${ds.verified ?? 0}/${ds.required_total ?? 0} verified`,
    caption: ds.held
      ? "Held for document review"
      : outstanding > 0
        ? `${outstanding} document${outstanding === 1 ? "" : "s"} pending`
        : "Documents complete",
    hasBreakdown: true,
  };
}
