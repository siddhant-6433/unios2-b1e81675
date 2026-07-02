export interface FeeProposalChildLike {
  lead_id?: string | null;
  course_id?: string | null;
  course_code?: string | null;
  course_name?: string | null;
  name?: string | null;
  applicant_name?: string | null;
  lead_name?: string | null;
  totals?: {
    annualBeforeWaiver?: number | string | null;
    beforeWaiver?: number | string | null;
    gross?: number | string | null;
  } | null;
  fee_items?: Array<{
    code?: string | null;
    name?: string | null;
    category?: string | null;
    term?: string | null;
    headerKey?: string | null;
    amount?: number | string | null;
    waiver?: number | string | null;
  }> | null;
}

export interface FeeProposalSource {
  proposalId: string;
  revisionNumber?: number | null;
  childKey: string;
  child: FeeProposalChildLike;
}

export interface OfferWaiverInsertDraft {
  term: string;
  amount: number;
  reason: string;
  source_type: "fee_proposal";
  source_fee_proposal_id: string;
  source_fee_proposal_child_key: string;
  metadata: Record<string, unknown>;
}

const numberValue = (value: unknown): number => {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? amount : 0;
};

export function feeProposalChildKey(child: FeeProposalChildLike, index: number): string {
  return [
    child.lead_id || "lead",
    child.course_id || child.course_code || "course",
    String(index + 1),
  ].join(":");
}

export function feeProposalChildLabel(child: FeeProposalChildLike, fallback = "Student"): string {
  const name = child.name || child.applicant_name || child.lead_name || fallback;
  const course = child.course_name || child.course_code || "";
  return course ? `${name} - ${course}` : name;
}

export function buildOfferWaiversFromFeeProposalChild(source: FeeProposalSource): OfferWaiverInsertDraft[] {
  const grouped = new Map<string, OfferWaiverInsertDraft>();
  const revision = source.revisionNumber ? ` Revision ${source.revisionNumber}` : "";

  for (const item of source.child.fee_items || []) {
    const amount = numberValue(item?.waiver);
    if (amount <= 0) continue;

    const term = String(item?.term || "year_1");
    const label = String(item?.name || item?.category || item?.headerKey || "Fee waiver");
    const headerKey = String(item?.headerKey || item?.code || `${term}:${label}`);
    const groupKey = `${term}|${headerKey}|${label}`;
    const existing = grouped.get(groupKey);

    if (existing) {
      existing.amount += amount;
      existing.metadata.item_count = numberValue(existing.metadata.item_count) + 1;
      existing.metadata.source_amount = numberValue(existing.metadata.source_amount) + numberValue(item?.amount);
      continue;
    }

    grouped.set(groupKey, {
      term,
      amount,
      reason: `Approved fee proposal${revision} - ${label}`,
      source_type: "fee_proposal",
      source_fee_proposal_id: source.proposalId,
      source_fee_proposal_child_key: source.childKey,
      metadata: {
        fee_head_label: label,
        fee_code: item?.code || null,
        category: item?.category || null,
        header_key: headerKey,
        proposal_revision_number: source.revisionNumber || null,
        proposal_child_name: source.child.name || source.child.applicant_name || null,
        proposal_child_course_id: source.child.course_id || null,
        proposal_child_lead_id: source.child.lead_id || null,
        source_amount: numberValue(item?.amount),
        item_count: 1,
      },
    });
  }

  return Array.from(grouped.values()).sort((a, b) => {
    const byTerm = a.term.localeCompare(b.term, undefined, { numeric: true });
    if (byTerm !== 0) return byTerm;
    return a.reason.localeCompare(b.reason);
  });
}

export function proposalFeeSnapshotDiff(child: FeeProposalChildLike, programmeTotal: number) {
  const proposalGross = numberValue(
    child?.totals?.annualBeforeWaiver ?? child?.totals?.beforeWaiver ?? child?.totals?.gross,
  );
  const currentGross = numberValue(programmeTotal);
  const diff = currentGross - proposalGross;

  return {
    proposalGross,
    currentGross,
    diff,
    hasMismatch: proposalGross > 0 && currentGross > 0 && Math.abs(diff) > 1,
  };
}
