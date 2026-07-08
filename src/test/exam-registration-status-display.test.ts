import { describe, expect, it } from "vitest";
import {
  type ExamCode,
  type ExamRegistrationStatus,
  examCodeForCourse,
  examCodeForApplication,
  examStatusLabel,
  examStatusClass,
  EXAM_SHORT_LABELS,
  EXAM_CODES,
} from "@/lib/examRegistration";

describe("examStatusLabel — all statuses render distinct labels", () => {
  const cases: [ExamRegistrationStatus, string][] = [
    ["unknown", "Unknown"],
    ["not_registered", "Not Registered"],
    ["registered_no_number", "Registered · no number"],
    ["registered", "Registered"],
  ];
  it.each(cases)("status '%s' → '%s'", (status, expected) => {
    expect(examStatusLabel(status)).toBe(expected);
  });
});

describe("examStatusClass — each status gets a distinct style", () => {
  it("not_registered gets rose (red) styling", () => {
    expect(examStatusClass("not_registered")).toContain("rose");
  });
  it("registered gets emerald (green) styling", () => {
    expect(examStatusClass("registered")).toContain("emerald");
  });
  it("registered_no_number gets amber styling", () => {
    expect(examStatusClass("registered_no_number")).toContain("amber");
  });
  it("unknown gets muted styling", () => {
    expect(examStatusClass("unknown")).toContain("muted");
  });
});

describe("exam_registration status derivation (Applications page logic)", () => {
  /**
   * Replicates the inline closure from Applications.tsx lines 584-593.
   * This is the exact logic that builds the badge data from the enrichment map.
   */
  function deriveExamRegistration(
    app: { course_selections?: Array<{ course_name?: string | null; campus_name?: string | null }> | null },
    examRegByLead: Record<string, Partial<Record<ExamCode, { status: ExamRegistrationStatus; registration_no: string | null }>>>,
    leadId: string,
  ) {
    const code = examCodeForApplication(app);
    if (!code) return null;
    const rec = examRegByLead[leadId]?.[code];
    return {
      examCode: code,
      status: (rec?.status ?? "unknown") as ExamRegistrationStatus,
      registrationNo: rec?.registration_no || null,
    };
  }

  it("returns null for courses with no exam gate", () => {
    const result = deriveExamRegistration(
      { course_selections: [{ course_name: "Bachelor of Business Administration (BBA)" }] },
      {},
      "lead-1",
    );
    expect(result).toBeNull();
  });

  it("defaults to 'unknown' when no exam_registrations record exists", () => {
    const result = deriveExamRegistration(
      { course_selections: [{ course_name: "Bachelor of Science in Nursing (B.Sc Nursing)" }] },
      {},
      "lead-1",
    );
    expect(result).toEqual({
      examCode: "cnet",
      status: "unknown",
      registrationNo: null,
    });
  });

  it("shows 'not_registered' when the DB record says not_registered", () => {
    const result = deriveExamRegistration(
      { course_selections: [{ course_name: "Bachelor of Science in Nursing (B.Sc Nursing)" }] },
      { "lead-1": { cnet: { status: "not_registered", registration_no: null } } },
      "lead-1",
    );
    expect(result).toEqual({
      examCode: "cnet",
      status: "not_registered",
      registrationNo: null,
    });
  });

  it("shows 'registered' with reg number when record has it", () => {
    const result = deriveExamRegistration(
      { course_selections: [{ course_name: "Bachelor of Physiotherapy (BPT)" }] },
      { "lead-2": { cahet: { status: "registered", registration_no: "CAHET-2026-12345" } } },
      "lead-2",
    );
    expect(result).toEqual({
      examCode: "cahet",
      status: "registered",
      registrationNo: "CAHET-2026-12345",
    });
  });

  it("shows 'registered_no_number' for partial registration", () => {
    const result = deriveExamRegistration(
      { course_selections: [{ course_name: "Diploma in Pharmacy (D.Pharma)" }] },
      { "lead-3": { jeecup: { status: "registered_no_number", registration_no: null } } },
      "lead-3",
    );
    expect(result).toEqual({
      examCode: "jeecup",
      status: "registered_no_number",
      registrationNo: null,
    });
  });

  it("handles B.Ed campus-dependent exam correctly", () => {
    const kotputli = deriveExamRegistration(
      { course_selections: [{ course_name: "Bachelor of Education (B.Ed)", campus_name: "Kotputli Jaipur Campus" }] },
      { "lead-4": { ptet: { status: "registered", registration_no: "PTET-001" } } },
      "lead-4",
    );
    expect(kotputli?.examCode).toBe("ptet");
    expect(kotputli?.status).toBe("registered");

    const noida = deriveExamRegistration(
      { course_selections: [{ course_name: "Bachelor of Education (B.Ed)", campus_name: "Greater Noida Campus" }] },
      { "lead-5": { jee_bed: { status: "not_registered", registration_no: null } } },
      "lead-5",
    );
    expect(noida?.examCode).toBe("jee_bed");
    expect(noida?.status).toBe("not_registered");
  });

  it("does not confuse lead_ids — wrong lead returns unknown", () => {
    const result = deriveExamRegistration(
      { course_selections: [{ course_name: "Bachelor of Science in Nursing (B.Sc Nursing)" }] },
      { "lead-other": { cnet: { status: "registered", registration_no: "CNET-001" } } },
      "lead-1",
    );
    expect(result?.status).toBe("unknown");
    expect(result?.registrationNo).toBeNull();
  });
});

describe("nullish coalescing correctness (?? vs ||)", () => {
  it("?? preserves falsy-but-valid status values if they ever appear", () => {
    // The DB CHECK constraint prevents empty strings, but ?? is the correct
    // operator regardless — || would coerce "" to "unknown".
    const rec = { status: "" as ExamRegistrationStatus, registration_no: null };
    expect(rec.status ?? "unknown").toBe("");
    expect(rec.status || "unknown").toBe("unknown");
  });
});

describe("EXAM_SHORT_LABELS — every exam code has a label", () => {
  it.each(EXAM_CODES)("exam code '%s' has a short label", (code) => {
    expect(EXAM_SHORT_LABELS[code]).toBeTruthy();
  });
});

describe("badge pill text format", () => {
  it("renders as 'EXAM_LABEL · StatusText'", () => {
    const examCode: ExamCode = "cnet";
    const status: ExamRegistrationStatus = "not_registered";
    const pillText = `${EXAM_SHORT_LABELS[examCode]} · ${examStatusLabel(status)}`;
    expect(pillText).toBe("CNET · Not Registered");
  });

  it("shows 'CAHET · Unknown' for unknown status", () => {
    const pillText = `${EXAM_SHORT_LABELS["cahet"]} · ${examStatusLabel("unknown")}`;
    expect(pillText).toBe("CAHET · Unknown");
  });

  it("shows 'JEE B.Ed · Registered' for registered status", () => {
    const pillText = `${EXAM_SHORT_LABELS["jee_bed"]} · ${examStatusLabel("registered")}`;
    expect(pillText).toBe("JEE B.Ed · Registered");
  });
});
