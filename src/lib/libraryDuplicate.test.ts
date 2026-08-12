import { describe, it, expect } from "vitest";
import { findDuplicateReason, normalizeIsbn, emptySeen, rememberSeen, type Catalog } from "./libraryDuplicate";

const empty: Catalog = { items: [], books: [], queue: [] };

describe("normalizeIsbn", () => {
  it("strips hyphens/spaces and keeps X", () => {
    expect(normalizeIsbn("978-0-13-468599-1")).toBe("9780134685991");
    expect(normalizeIsbn("0-8044-2957-x")).toBe("080442957x");
    expect(normalizeIsbn("")).toBe("");
  });
});

describe("findDuplicateReason", () => {
  it("returns null for a genuinely new record", () => {
    expect(findDuplicateReason({ isbn: "9780134685991", branchId: "b1" }, empty)).toBeNull();
  });

  it("flags an accession already in the catalog for the same institution", () => {
    const cat: Catalog = { ...empty, items: [{ institution_id: "inst1", accession_no: "ACC-100" }] };
    expect(findDuplicateReason({ accession: "acc-100", branchId: "b1", institutionId: "inst1" }, cat)).toMatch(/already exists in the catalog/);
    // different institution → not a duplicate
    expect(findDuplicateReason({ accession: "acc-100", branchId: "b1", institutionId: "inst2" }, cat)).toBeNull();
  });

  it("flags an ISBN already in the catalog, ignoring formatting", () => {
    const cat: Catalog = { ...empty, books: [{ isbn_13: "978-0-13-468599-1" }] };
    expect(findDuplicateReason({ isbn: "9780134685991", branchId: "b1" }, cat)).toMatch(/ISBN .* already exists/);
  });

  it("flags a record already pending in the same branch's queue", () => {
    const cat: Catalog = { ...empty, queue: [{ branch_id: "b1", status: "needs_review", isbn: "9780134685991", accession_no: null, scanned_barcode: null }] };
    expect(findDuplicateReason({ isbn: "9780134685991", branchId: "b1" }, cat)).toBe("Already in the review queue");
    // rejected/duplicate rows don't count, and other branches don't count
    const rejected: Catalog = { ...empty, queue: [{ branch_id: "b1", status: "rejected", isbn: "9780134685991", accession_no: null, scanned_barcode: null }] };
    expect(findDuplicateReason({ isbn: "9780134685991", branchId: "b1" }, rejected)).toBeNull();
    expect(findDuplicateReason({ isbn: "9780134685991", branchId: "b2" }, cat)).toBeNull();
  });

  it("catches duplicates within the same import batch via the seen set", () => {
    const seen = emptySeen();
    expect(findDuplicateReason({ isbn: "9780134685991", branchId: "b1" }, empty, seen)).toBeNull();
    rememberSeen(seen, { isbn: "9780134685991" });
    // second row, same isbn in different formatting
    expect(findDuplicateReason({ isbn: "978-0-13-468599-1", branchId: "b1" }, empty, seen)).toBe("Duplicate ISBN within this import");
  });

  it("matches on barcode too", () => {
    const cat: Catalog = { ...empty, queue: [{ branch_id: "b1", status: "captured", isbn: null, accession_no: null, scanned_barcode: "BC-9" }] };
    expect(findDuplicateReason({ barcode: "bc-9", branchId: "b1" }, cat)).toBe("Already in the review queue");
  });
});
