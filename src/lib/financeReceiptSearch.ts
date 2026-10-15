export type ReceiptCursor = {
  paidAt: string | null;
  id: string;
  source: "lead" | "student";
};

function escapedSearchFields(search: string): string[] {
  const searchTerm = search.trim();
  return searchTerm
    ? ["person_name", "admission_no", "receipt_no", "transaction_ref", "bank_ref_num"].map((field) => {
        const escaped = searchTerm.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
        return `${field}.ilike."%${escaped}%"`;
      })
    : [];
}

/** Exact UPI/NEFT reference lookup used by the duplicate warning deep link. */
export function buildReceiptExactReferenceFilter(reference: string): string | null {
  const value = reference.trim();
  if (!value) return null;
  const escaped = value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return [`transaction_ref.eq."${escaped}"`, `bank_ref_num.eq."${escaped}"`].join(",");
}

export function buildReceiptReviewPath(reference: string): string {
  return `/finance?tab=receipts&receipt_ref=${encodeURIComponent(reference.trim())}`;
}

function campusSearchFields(campusId: string): string[] {
  return campusId !== "all"
    ? [`campus_id.eq.${campusId}`, "campus_id.is.null"]
    : [];
}

/** Builds the PostgREST OR expression used by the Finance receipts query. */
export function buildReceiptSearchFilter(search: string, campusId: string): string | null {
  const campusFilters = campusSearchFields(campusId);
  const searchFilters = escapedSearchFields(search);

  if (searchFilters.length && campusFilters.length) {
    return `and(or(${searchFilters.join(",")}),or(${campusFilters.join(",")}))`;
  }
  if (searchFilters.length) return searchFilters.join(",");
  if (campusFilters.length) return campusFilters.join(",");
  return null;
}

/**
 * Builds the next-page predicate for paid_at DESC NULLS LAST, id DESC, source DESC.
 * Dated cursors include all later null-dated rows; null cursors stay in the
 * null partition. The final source comparison also makes cross-view ID ties stable.
 */
export function buildReceiptCursorFilter(cursor: ReceiptCursor): string {
  if (cursor.paidAt === null) {
    return [
      `and(paid_at.is.null,id.lt.${cursor.id})`,
      `and(paid_at.is.null,id.eq.${cursor.id},source.lt.${cursor.source})`,
    ].join(",");
  }

  return [
    `paid_at.lt.${cursor.paidAt}`,
    `and(paid_at.eq.${cursor.paidAt},id.lt.${cursor.id})`,
    `and(paid_at.eq.${cursor.paidAt},id.eq.${cursor.id},source.lt.${cursor.source})`,
    "paid_at.is.null",
  ].join(",");
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
  cursor?: ReceiptCursor | null,
  exactReference?: string,
): T {
  const exactFilter = buildReceiptExactReferenceFilter(exactReference || "");
  const searchFilter = exactFilter || buildReceiptSearchFilter(search, campusId);
  const campusFilters = campusSearchFields(campusId);
  if (cursor) {
    const groups: string[] = [];
    if (exactFilter) groups.push(`or(${exactFilter})`);
    else {
      const searchFilters = escapedSearchFields(search);
      if (searchFilters.length) groups.push(`or(${searchFilters.join(",")})`);
    }
    if (campusFilters.length) groups.push(`or(${campusFilters.join(",")})`);
    groups.push(`or(${buildReceiptCursorFilter(cursor)})`);
    query = query.or(groups.length === 1 ? buildReceiptCursorFilter(cursor) : `and(${groups.join(",")})`);
  } else if (searchFilter) {
    if (exactFilter && campusFilters.length) {
      query = query.or(`and(or(${exactFilter}),or(${campusFilters.join(",")}))`);
    } else {
      query = query.or(searchFilter);
    }
  }
  if (paymentMode !== "all") query = query.eq("payment_mode", paymentMode);
  return query;
}
