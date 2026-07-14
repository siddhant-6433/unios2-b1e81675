import { describe, expect, it } from "vitest";
import {
  type ExamCode,
  type ExamRegistrationStatus,
  examCodeForCourse,
  examStatusLabel,
} from "@/lib/examRegistration";

/**
 * Integration-level tests for the exam_registrations data flow.
 *
 * Root cause (2026-07-07): the `exam_registrations` table was created with
 * RLS policies but WITHOUT `GRANT ... TO authenticated`. PostgREST reads
 * as the `authenticated` role, so all REST SELECTs returned zero rows.
 * The SECURITY DEFINER RPCs (exam_set_status, exam_mark_registered) ran
 * as `postgres` and worked — masking the missing grant.
 *
 * Fix: 20260707180000_exam_registrations_grant_authenticated.sql adds
 * `GRANT SELECT, INSERT, UPDATE ON exam_registrations TO authenticated`.
 *
 * These tests verify the contract between the data layer and the UI.
 */

describe("exam_registrations data → badge mapping contract", () => {
  type ExamRegRow = {
    lead_id: string;
    exam_code: ExamCode;
    status: ExamRegistrationStatus;
    registration_no: string | null;
  };

  function buildExamRegByLead(rows: ExamRegRow[]) {
    const out: Record<string, Partial<Record<ExamCode, { status: ExamRegistrationStatus; registration_no: string | null }>>> = {};
    for (const r of rows) {
      (out[r.lead_id] ||= {})[r.exam_code] = {
        status: r.status,
        registration_no: r.registration_no,
      };
    }
    return out;
  }

  function resolveBadge(
    leadId: string,
    courseName: string,
    campusName: string | undefined,
    rows: ExamRegRow[],
  ) {
    const code = examCodeForCourse(courseName, campusName);
    if (!code) return null;
    const byLead = buildExamRegByLead(rows);
    const rec = byLead[leadId]?.[code];
    return {
      examCode: code,
      status: (rec?.status ?? "unknown") as ExamRegistrationStatus,
      label: examStatusLabel((rec?.status ?? "unknown") as ExamRegistrationStatus),
      registrationNo: rec?.registration_no || null,
    };
  }

  it("CNET not_registered renders correctly when DB row exists", () => {
    const badge = resolveBadge("lead-mayank", "Bachelor of Science in Nursing (B.Sc Nursing)", undefined, [
      { lead_id: "lead-mayank", exam_code: "cnet", status: "not_registered", registration_no: null },
    ]);
    expect(badge).not.toBeNull();
    expect(badge!.examCode).toBe("cnet");
    expect(badge!.status).toBe("not_registered");
    expect(badge!.label).toBe("Not Registered");
  });

  it("CNET shows Unknown when DB returns zero rows (pre-fix behavior)", () => {
    const badge = resolveBadge("lead-mayank", "Bachelor of Science in Nursing (B.Sc Nursing)", undefined, []);
    expect(badge!.status).toBe("unknown");
    expect(badge!.label).toBe("Unknown");
  });

  it("CAHET registered with number from backfill", () => {
    const badge = resolveBadge("lead-1", "Bachelor of Physiotherapy (BPT)", undefined, [
      { lead_id: "lead-1", exam_code: "cahet", status: "registered", registration_no: "CAHET-2026-999" },
    ]);
    expect(badge!.status).toBe("registered");
    expect(badge!.label).toBe("Registered");
    expect(badge!.registrationNo).toBe("CAHET-2026-999");
  });

  it("multiple leads do not cross-contaminate", () => {
    const rows: ExamRegRow[] = [
      { lead_id: "lead-a", exam_code: "cnet", status: "registered", registration_no: "CNET-001" },
      { lead_id: "lead-b", exam_code: "cnet", status: "not_registered", registration_no: null },
    ];
    const badgeA = resolveBadge("lead-a", "Bachelor of Science in Nursing (B.Sc Nursing)", undefined, rows);
    const badgeB = resolveBadge("lead-b", "Bachelor of Science in Nursing (B.Sc Nursing)", undefined, rows);
    expect(badgeA!.status).toBe("registered");
    expect(badgeB!.status).toBe("not_registered");
  });

  it("wrong exam_code for a lead returns unknown", () => {
    const badge = resolveBadge("lead-x", "Bachelor of Science in Nursing (B.Sc Nursing)", undefined, [
      { lead_id: "lead-x", exam_code: "cahet", status: "registered", registration_no: "CAHET-001" },
    ]);
    expect(badge!.examCode).toBe("cnet");
    expect(badge!.status).toBe("unknown");
  });

  it("UPDELED registered shows correctly", () => {
    const badge = resolveBadge("lead-d", "Diploma in Elementary Education (D.El.Ed)", undefined, [
      { lead_id: "lead-d", exam_code: "updeled", status: "registered", registration_no: "UPDELED-777" },
    ]);
    expect(badge!.examCode).toBe("updeled");
    expect(badge!.status).toBe("registered");
    expect(badge!.registrationNo).toBe("UPDELED-777");
  });

  it("JEECUP for D.Pharma resolves correctly", () => {
    const badge = resolveBadge("lead-e", "Diploma in Pharmacy (D.Pharma)", undefined, [
      { lead_id: "lead-e", exam_code: "jeecup", status: "registered_no_number", registration_no: null },
    ]);
    expect(badge!.examCode).toBe("jeecup");
    expect(badge!.status).toBe("registered_no_number");
    expect(badge!.label).toBe("Registered · no number");
  });
});

describe("grant migration SQL contract", () => {
  it("migration file grants SELECT, INSERT, UPDATE to authenticated", async () => {
    const fs = await import("fs");
    const path = await import("path");
    const migrationPath = path.resolve(
      __dirname,
      "../../supabase/migrations/20260707180000_exam_registrations_grant_authenticated.sql",
    );
    const sql = fs.readFileSync(migrationPath, "utf-8").toLowerCase();
    expect(sql).toContain("grant");
    expect(sql).toContain("select");
    expect(sql).toContain("insert");
    expect(sql).toContain("update");
    expect(sql).toContain("exam_registrations");
    expect(sql).toContain("authenticated");
  });
});
