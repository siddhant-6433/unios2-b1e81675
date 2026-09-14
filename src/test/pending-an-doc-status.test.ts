import { describe, expect, it } from "vitest";
import {
  computeAdmissionDocStatus,
  getRequiredDocs,
} from "../../supabase/functions/_shared/requiredDocs";
import { pendingAnDocSummary } from "@/lib/pendingAnGeneration";

describe("computeAdmissionDocStatus", () => {
  const required = getRequiredDocs("undergraduate", {
    class_10: { result_status: "declared" },
    class_12: { result_status: "declared" },
  }, [], "GN");

  it("stays incomplete when a required key was never uploaded, even if other files are verified", () => {
    const status = computeAdmissionDocStatus(required, [
      { doc_key: "class_10_marksheet", review_status: "verified" },
      { doc_key: "class_12_marksheet", review_status: "verified" },
      { doc_key: "other_document", review_status: "verified" },
    ]);
    expect(status.complete).toBe(false);
    expect(status.missing).toBe(1);
    expect(status.docs.find(d => d.key === "aadhaar")?.state).toBe("missing");
  });

  it("stays incomplete while any uploaded file is still pending review", () => {
    const status = computeAdmissionDocStatus(required, [
      { doc_key: "class_10_marksheet", review_status: "verified" },
      { doc_key: "class_12_marksheet", review_status: "verified" },
      { doc_key: "aadhaar", review_status: "pending" },
    ]);
    expect(status.complete).toBe(false);
    expect(status.pending).toBe(1);
    expect(status.verified).toBe(2);
  });

  it("counts a passport_photo upload against the school student_photo requirement", () => {
    const schoolRequired = getRequiredDocs("school", {}, [{ course_name: "LKG" }], "GN");
    const status = computeAdmissionDocStatus(schoolRequired, [
      { doc_key: "passport_photo", review_status: "verified" },
      { doc_key: "aadhaar", review_status: "verified" },
    ]);
    expect(status.complete).toBe(true);
    const photo = status.docs.find(d => d.key === "student_photo");
    expect(photo?.state).toBe("verified");
  });
});

describe("pendingAnDocSummary", () => {
  it("does not pretend 0/0 is complete when the gate has no breakdown", () => {
    expect(pendingAnDocSummary(null)).toEqual({
      ratio: "—",
      caption: "Verification status unavailable",
      hasBreakdown: false,
    });
    expect(pendingAnDocSummary({})).toEqual({
      ratio: "—",
      caption: "Verification status unavailable",
      hasBreakdown: false,
    });
  });

  it("shows outstanding mandatory documents when the breakdown exists", () => {
    expect(pendingAnDocSummary({
      required_total: 4,
      verified: 3,
      pending: 1,
      missing: 0,
      rejected: 0,
      docs: [{ key: "aadhaar", label: "Aadhaar", state: "pending" }],
    })).toEqual({
      ratio: "3/4 verified",
      caption: "1 document pending",
      hasBreakdown: true,
    });
  });

  it("labels a held file as held even when the mandatory keys look complete", () => {
    expect(pendingAnDocSummary({
      held: true,
      complete: true,
      required_total: 4,
      verified: 4,
      pending: 0,
      missing: 0,
      rejected: 0,
      docs: [{ key: "aadhaar", label: "Aadhaar", state: "verified" }],
    }).caption).toBe("Held for document review");
  });
});
