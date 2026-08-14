import { describe, it, expect } from "vitest";
import {
  buildSlots, outstanding, mandatoryOutstanding, byFolder, daysUntil, expiryState,
  documentPath, type DocType, type DocRow,
} from "./employeeDocuments";

const TODAY = new Date(2026, 7, 14); // 14 Aug 2026

const type = (over: Partial<DocType> & { code: string }): DocType => ({
  name: over.code, folder: "Onboarding", is_mandatory: false, has_expiry: false,
  sort_order: 100, ...over,
});

const doc = (over: Partial<DocRow> & { doc_key: string }): DocRow => ({
  id: `id-${over.doc_key}`, file_name: "f.pdf", file_path: "p", mime_type: "application/pdf",
  status: "pending", review_note: null, issued_on: null, expires_on: null,
  uploaded_at: "2026-08-01T00:00:00Z", ...over,
});

describe("buildSlots", () => {
  it("emits a slot for every catalogue entry, uploaded or not", () => {
    const slots = buildSlots([type({ code: "a" }), type({ code: "b" })], [doc({ doc_key: "a" })], TODAY);
    expect(slots).toHaveLength(2);
    expect(slots.find((s) => s.type.code === "b")!.status).toBe("missing");
    expect(slots.find((s) => s.type.code === "a")!.status).toBe("pending");
  });

  it("puts mandatory documents first", () => {
    const slots = buildSlots(
      [type({ code: "optional", sort_order: 1 }), type({ code: "must", is_mandatory: true, sort_order: 99 })],
      [], TODAY,
    );
    expect(slots[0].type.code).toBe("must");
  });
});

describe("outstanding", () => {
  it("counts missing and rejected, but not a document awaiting review", () => {
    const types = [type({ code: "a" }), type({ code: "b" }), type({ code: "c" })];
    const docs = [doc({ doc_key: "a", status: "verified" }), doc({ doc_key: "b", status: "rejected" })];
    // c was never uploaded
    const slots = buildSlots(types, docs, TODAY);
    expect(outstanding(slots).map((s) => s.type.code).sort()).toEqual(["b", "c"]);
  });

  it("separates the mandatory ones, which are what block onboarding", () => {
    const slots = buildSlots(
      [type({ code: "must", is_mandatory: true }), type({ code: "nice" })], [], TODAY,
    );
    expect(outstanding(slots)).toHaveLength(2);
    expect(mandatoryOutstanding(slots).map((s) => s.type.code)).toEqual(["must"]);
  });

  it("a pending upload is not outstanding — the employee has done their part", () => {
    const slots = buildSlots([type({ code: "a" })], [doc({ doc_key: "a", status: "pending" })], TODAY);
    expect(outstanding(slots)).toHaveLength(0);
  });
});

describe("expiry", () => {
  it("reads whole days in both directions", () => {
    expect(daysUntil("2026-08-14", TODAY)).toBe(0);
    expect(daysUntil("2026-08-24", TODAY)).toBe(10);
    expect(daysUntil("2026-08-04", TODAY)).toBe(-10);
    expect(daysUntil(null, TODAY)).toBeNull();
  });

  it("flags anything inside 30 days, and only then", () => {
    expect(expiryState(null)).toBe("none");
    expect(expiryState(-1)).toBe("expired");
    expect(expiryState(0)).toBe("expiring");
    expect(expiryState(30)).toBe("expiring");
    expect(expiryState(31)).toBe("valid");
  });

  it("carries expiry through to the slot", () => {
    const slots = buildSlots(
      [type({ code: "dl", has_expiry: true })],
      [doc({ doc_key: "dl", status: "verified", expires_on: "2026-08-20" })],
      TODAY,
    );
    expect(slots[0].daysToExpiry).toBe(6);
    expect(slots[0].expiry).toBe("expiring");
  });
});

describe("byFolder", () => {
  it("groups and counts what has actually been uploaded", () => {
    const types = [
      type({ code: "a", folder: "Identity" }),
      type({ code: "b", folder: "Identity" }),
      type({ code: "c", folder: "Payroll" }),
    ];
    const groups = byFolder(buildSlots(types, [doc({ doc_key: "a" })], TODAY));
    const identity = groups.find((g) => g.folder === "Identity")!;
    expect(identity.slots).toHaveLength(2);
    expect(identity.uploaded).toBe(1);
    expect(groups.find((g) => g.folder === "Payroll")!.uploaded).toBe(0);
  });
});

describe("documentPath", () => {
  it("puts the employee id first — storage RLS keys off that folder", () => {
    expect(documentPath("emp-1", "resume", "My CV.PDF", 42)).toBe("emp-1/resume-42.pdf");
  });

  it("survives a file with no extension", () => {
    expect(documentPath("emp-1", "resume", "scan", 7)).toBe("emp-1/resume-7.bin");
  });
});
