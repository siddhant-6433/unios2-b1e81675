type FeeHeadCandidate = {
  fee_code_id: string;
  term: string;
  fee_code_code?: string | null;
  fee_code_name?: string | null;
};

/**
 * Drop already-provisioned heads and repeated application-fee items from one
 * fee-structure result. Other fee rows retain their existing behavior.
 */
export function dedupeNewFeeHeads<T extends FeeHeadCandidate>(
  rows: T[],
  existingKeys: Set<string>,
): T[] {
  const seenApplicationFeeHeads = new Set<string>();
  return rows.filter((row) => {
    const key = `${row.fee_code_id}::${row.term}`;
    if (existingKeys.has(key)) return false;

    const isApplicationFeeHead =
      String(row.term || "").toLowerCase() === "registration" &&
      (/^(FORM-FEE|MR-REG|NB-REG)$/i.test(String(row.fee_code_code || "")) ||
        /application fee/i.test(String(row.fee_code_name || "")));
    if (!isApplicationFeeHead) return true;
    if (seenApplicationFeeHeads.has(key)) return false;
    seenApplicationFeeHeads.add(key);
    return true;
  });
}
