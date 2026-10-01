type RefundableLeadPayment = {
  id: string;
  lead_id?: string | null;
  student_id?: string | null;
  source?: string | null;
  fee_type?: string | null;
  status?: string | null;
  type?: string | null;
};

export function hasEligibleLeadRefundPayment(payments: readonly RefundableLeadPayment[]): boolean {
  return payments.some((payment) => payment.status === "confirmed" && payment.type !== "application_fee");
}

export function getLeadRefundActionRows(
  payments: readonly RefundableLeadPayment[],
  canRefund: boolean,
): Set<string> {
  const actionRows = new Set<string>();
  if (!canRefund) return actionRows;

  const seenCandidates = new Set<string>();
  for (const payment of payments) {
    if (payment.source !== "lead" || payment.fee_type === "application_fee") continue;
    const candidateKey = payment.lead_id || payment.student_id;
    if (!candidateKey || seenCandidates.has(candidateKey)) continue;
    seenCandidates.add(candidateKey);
    actionRows.add(payment.id);
  }
  return actionRows;
}
