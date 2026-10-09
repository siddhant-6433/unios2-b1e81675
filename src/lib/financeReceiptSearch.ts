/** Builds the PostgREST OR expression used by the Finance receipts query. */
export function buildReceiptSearchFilter(search: string, campusId: string): string | null {
  const searchTerm = search.trim();
  const campusFilters = campusId !== "all"
    ? [`campus_id.eq.${campusId}`, "campus_id.is.null"]
    : [];
  const searchFilters = searchTerm
    ? ["person_name", "admission_no", "receipt_no"].map((field) => {
        const escaped = searchTerm.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
        return `${field}.ilike."%${escaped}%"`;
      })
    : [];

  if (searchFilters.length && campusFilters.length) {
    return `and(or(${searchFilters.join(",")}),or(${campusFilters.join(",")}))`;
  }
  if (searchFilters.length) return searchFilters.join(",");
  if (campusFilters.length) return campusFilters.join(",");
  return null;
}

type ReceiptQueryFilters<T> = {
  or: (filter: string) => T;
  eq: (column: "payment_mode", value: string) => T;
};

/** Applies optional search/campus and payment-mode filters before the row limit. */
export function applyReceiptQueryFilters<T extends ReceiptQueryFilters<T>>(
  query: T,
  search: string,
  campusId: string,
  paymentMode: string,
): T {
  const searchFilter = buildReceiptSearchFilter(search, campusId);
  if (searchFilter) query = query.or(searchFilter);
  if (paymentMode !== "all") query = query.eq("payment_mode", paymentMode);
  return query;
}
