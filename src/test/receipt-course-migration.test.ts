import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  combineReceiptNotes,
  courseNameFromRelation,
  isReceiptStaleForCourse,
  paymentsNeedingCourseRevision,
  receiptCourseMigrationNote,
  resolveReceiptCourseName,
} from "@/lib/receiptCourseMigration";

const BMRIT_TO_DAOTT = {
  created_at: "2026-09-08T09:00:00.000Z",
  old_label: "BMRIT",
  new_label: "DAOTT",
};

describe("resolveReceiptCourseName", () => {
  it("prints the student course even when the lead still has the enquiry course", () => {
    expect(resolveReceiptCourseName({
      studentCourseName: "DAOTT",
      leadCourseName: "BMRIT",
      applicationCourseName: "BMRIT",
    })).toBe("DAOTT");
  });

  it("falls back to the lead, then the application, when there is no student yet", () => {
    expect(resolveReceiptCourseName({
      leadCourseName: "BMRIT",
      applicationCourseName: "Application BMRIT",
    })).toBe("BMRIT");
    expect(resolveReceiptCourseName({
      applicationCourseName: "Application BMRIT",
    })).toBe("Application BMRIT");
  });
});

describe("receiptCourseMigrationNote", () => {
  it("annotates a receipt that was issued before the course moved", () => {
    expect(receiptCourseMigrationNote(
      "2026-08-26T10:00:00.000Z",
      "DAOTT",
      [BMRIT_TO_DAOTT],
    )).toBe("This receipt was migrated from previous course BMRIT to current course DAOTT");
  });

  it("leaves receipts issued after the move alone", () => {
    expect(receiptCourseMigrationNote(
      "2026-09-09T10:00:00.000Z",
      "DAOTT",
      [BMRIT_TO_DAOTT],
    )).toBeNull();
  });

  it("walks multiple moves from the course at payment time to the current course", () => {
    expect(receiptCourseMigrationNote("2026-07-01T00:00:00.000Z", "DAOTT", [
      { created_at: "2026-08-01T00:00:00.000Z", old_label: "BMRIT", new_label: "GNM" },
      { created_at: "2026-09-01T00:00:00.000Z", old_label: "GNM", new_label: "DAOTT" },
    ])).toBe("This receipt was migrated from previous course BMRIT to current course DAOTT");
  });
});

describe("stale receipt detection", () => {
  it("treats a pre-move receipt as stale until it is stamped with the current course", () => {
    expect(isReceiptStaleForCourse({
      paymentDate: "2026-08-26T10:00:00.000Z",
      receiptCourseId: null,
      currentCourseId: "daott-id",
      courseChanges: [BMRIT_TO_DAOTT],
    })).toBe(true);

    expect(isReceiptStaleForCourse({
      paymentDate: "2026-08-26T10:00:00.000Z",
      receiptCourseId: "daott-id",
      currentCourseId: "daott-id",
      courseChanges: [BMRIT_TO_DAOTT],
    })).toBe(false);
  });

  it("does not nag students who were never migrated", () => {
    expect(paymentsNeedingCourseRevision(
      [{ status: "confirmed", payment_date: "2026-08-26T10:00:00.000Z", receipt_course_id: null }],
      "daott-id",
      [],
    )).toHaveLength(0);
  });
});

describe("helpers", () => {
  it("reads a course name off a PostgREST object or array embed", () => {
    expect(courseNameFromRelation({ name: "DAOTT" })).toBe("DAOTT");
    expect(courseNameFromRelation([{ name: "DAOTT" }])).toBe("DAOTT");
    expect(courseNameFromRelation(null)).toBeNull();
  });

  it("puts the migration sentence ahead of any operator notes", () => {
    expect(combineReceiptNotes(
      "This receipt was migrated from previous course BMRIT to current course DAOTT",
      "Bank: HDFC",
    )).toBe("This receipt was migrated from previous course BMRIT to current course DAOTT\nBank: HDFC");
  });
});

describe("the Deno copy cannot drift from src/lib", () => {
  it("produces identical notes and course resolution", async () => {
    const deno = await import("../../supabase/functions/_shared/receiptCourseMigration.ts");
    expect(deno.resolveReceiptCourseName({
      studentCourseName: "DAOTT",
      leadCourseName: "BMRIT",
    })).toBe(resolveReceiptCourseName({
      studentCourseName: "DAOTT",
      leadCourseName: "BMRIT",
    }));
    expect(deno.receiptCourseMigrationNote("2026-08-26T10:00:00.000Z", "DAOTT", [BMRIT_TO_DAOTT]))
      .toBe(receiptCourseMigrationNote("2026-08-26T10:00:00.000Z", "DAOTT", [BMRIT_TO_DAOTT]));
    expect(deno.combineReceiptNotes("migrated", "manual")).toBe(combineReceiptNotes("migrated", "manual"));
  });
});

describe("receipt_course_revision migration", () => {
  it("stamps the course the PDF was generated for", () => {
    const dir = join(process.cwd(), "supabase/migrations");
    const file = readdirSync(dir).find((f) => f.endsWith("_receipt_course_revision.sql"));
    if (!file) throw new Error("No migration found ending in _receipt_course_revision.sql");
    const sql = readFileSync(join(dir, file), "utf8");
    expect(sql).toContain("ADD COLUMN IF NOT EXISTS receipt_course_id");
    expect(sql).toContain("REFERENCES public.courses(id)");
  });
});

describe("generate-payment-receipt uses the live student course", () => {
  const receiptFn = readFileSync("supabase/functions/generate-payment-receipt/index.ts", "utf8");
  const placementUi = readFileSync("src/pages/StudentProfile.tsx", "utf8");
  const feePanel = readFileSync("src/components/finance/StudentFeePanel.tsx", "utf8");
  const reviseHelper = readFileSync("src/lib/reviseStudentReceipts.ts", "utf8");

  it("looks the student up from the lead when the payment row has no student_id", () => {
    expect(receiptFn).toContain("receiptCourseMigration");
    expect(receiptFn).toContain('.eq("lead_id", lead.id)');
    expect(receiptFn).toContain("resolveReceiptCourseName");
    expect(receiptFn).toContain("receiptCourseMigrationNote");
    expect(receiptFn).toContain("receipt_course_id");
    expect(receiptFn).not.toContain("Student transferred");
  });

  it("revises existing PDFs when the course is changed and from the finance ledger", () => {
    expect(placementUi).toContain("reviseStudentReceiptPdfs");
    expect(feePanel).toContain("Revise receipts");
    expect(feePanel).toContain("reviseStudentReceiptPdfs");
    expect(reviseHelper).toContain("generate-payment-receipt");
  });
});
