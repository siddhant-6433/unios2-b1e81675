/**
 * Campus scoping for finance lists.
 *
 * A row whose campus_id is null means "couldn't be resolved" — a pre-admission
 * lead payment the caller can't join through, typically — not "belongs to a
 * different campus". Treating null as a mismatch is what made the Collections
 * page render empty for accountants: v_all_payments is security_invoker, so
 * every lead-sourced row came back with campus_id = null and was filtered out.
 */
export const matchesCampus = (
  rowCampusId: string | null | undefined,
  selectedCampusId: string,
) => selectedCampusId === "all" || !rowCampusId || rowCampusId === selectedCampusId;
