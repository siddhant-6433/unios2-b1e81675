// Duplicate detection for library digitization capture (manual + bulk import).
// Pure functions so the logic can be unit-tested independently of the page.

export function normalizeIsbn(value: string): string {
  return (value || "").replace(/[^0-9Xx]/g, "");
}

export type CatalogItem = { institution_id: string; accession_no: string };
export type CatalogBook = { isbn_13?: string | null; isbn_10?: string | null };
export type QueueRecord = {
  branch_id: string | null;
  status: string;
  isbn: string | null;
  accession_no: string | null;
  scanned_barcode: string | null;
};
export type SeenKeys = { isbns: Set<string>; accessions: Set<string>; barcodes: Set<string> };

export type DuplicateInput = {
  isbn?: string | null;
  accession?: string | null;
  barcode?: string | null;
  branchId: string;
  institutionId?: string | null;
};

export type Catalog = {
  items: CatalogItem[];
  books: CatalogBook[];
  queue: QueueRecord[];
};

// Returns a human-readable reason a record looks like a duplicate, or null if new.
// Checks, in order: the catalog (by accession within institution, by ISBN),
// the pending review queue (same branch, ignoring already rejected/duplicate rows),
// and — when `seen` is supplied — earlier rows of the same import batch.
export function findDuplicateReason(
  input: DuplicateInput,
  catalog: Catalog,
  seen?: SeenKeys,
): string | null {
  const isbn = normalizeIsbn(input.isbn || "");
  const accession = (input.accession || "").trim().toLowerCase();
  const barcode = (input.barcode || "").trim().toLowerCase();

  if (accession && input.institutionId && catalog.items.some(
    (item) => item.institution_id === input.institutionId && item.accession_no.toLowerCase() === accession,
  )) {
    return `Accession ${input.accession} already exists in the catalog`;
  }
  if (isbn && catalog.books.some((book) => normalizeIsbn(book.isbn_13 || book.isbn_10 || "") === isbn)) {
    return `ISBN ${isbn} already exists in the catalog`;
  }

  const inQueue = catalog.queue.some((r) => {
    if (r.branch_id !== input.branchId || r.status === "rejected" || r.status === "duplicate") return false;
    return (isbn && normalizeIsbn(r.isbn || "") === isbn)
      || (accession && (r.accession_no || "").trim().toLowerCase() === accession)
      || (barcode && (r.scanned_barcode || "").trim().toLowerCase() === barcode);
  });
  if (inQueue) return "Already in the review queue";

  if (seen) {
    if (isbn && seen.isbns.has(isbn)) return "Duplicate ISBN within this import";
    if (accession && seen.accessions.has(accession)) return "Duplicate accession within this import";
    if (barcode && seen.barcodes.has(barcode)) return "Duplicate barcode within this import";
  }
  return null;
}

// Records a row's keys into the seen-set so later rows of the same batch can be compared.
export function rememberSeen(seen: SeenKeys, input: { isbn?: string | null; accession?: string | null; barcode?: string | null }) {
  const isbn = normalizeIsbn(input.isbn || "");
  const accession = (input.accession || "").trim().toLowerCase();
  const barcode = (input.barcode || "").trim().toLowerCase();
  if (isbn) seen.isbns.add(isbn);
  if (accession) seen.accessions.add(accession);
  if (barcode) seen.barcodes.add(barcode);
}

export function emptySeen(): SeenKeys {
  return { isbns: new Set(), accessions: new Set(), barcodes: new Set() };
}
