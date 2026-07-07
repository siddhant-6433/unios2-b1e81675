import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import { isDeledCourseName, updeledRegistrationFromApplication } from "@/lib/updeled";

const offerLetterDialog = readFileSync("src/components/admissions/OfferLetterDialog.tsx", "utf8");
const offerLetterFunction = readFileSync("supabase/functions/generate-offer-letter/index.ts", "utf8");
const leadDetailPage = readFileSync("src/pages/LeadDetail.tsx", "utf8");
const counsellorDashboard = readFileSync("src/pages/CounsellorDashboard.tsx", "utf8");
const updeledLeaderboard = readFileSync("src/components/dashboard/UpdeledSprintLeaderboard.tsx", "utf8");
const appRoutes = readFileSync("src/App.tsx", "utf8");
const updeledSprintPage = readFileSync("src/pages/UpdeledSprint.tsx", "utf8");
const migration = readFileSync("supabase/migrations/20260626090000_updeled_sprint.sql", "utf8");

describe("UPDELED registration flow", () => {
  it("detects D.El.Ed course names", () => {
    expect(isDeledCourseName("Diploma in Elementary Education (D.El.Ed)")).toBe(true);
    expect(isDeledCourseName("DELED-GZ")).toBe(true);
    expect(isDeledCourseName("Bachelor of Physiotherapy")).toBe(false);
  });

  it("derives UPDELED registration from applicant-entered academic details", () => {
    const registration = updeledRegistrationFromApplication({
      id: "app-row",
      application_id: "APP-26-DELED",
      lead_id: "lead-1",
      academic_details: {
        entrance_exams: [{
          exam_name: "UP D.El.Ed Counselling",
          status: "registered",
          registration_no: " UPDELED-2026-12345 ",
          registered_name: "Applicant Name",
        }],
      },
    });

    expect(registration).toMatchObject({
      id: "application:APP-26-DELED:updeled",
      lead_id: "lead-1",
      registration_no: "UPDELED-2026-12345",
      notes: "Name on UPDELED form: Applicant Name",
    });
  });

  it("blocks D.El.Ed offer issuance when UPDELED registration details are missing", () => {
    expect(offerLetterDialog).toContain("const requiresUpdeledRegistration = isDeledCourseName(courseName)");
    expect(offerLetterDialog).toContain("const updeledOfferBlocked = requiresUpdeledRegistration && !updeledRegistration");
    expect(offerLetterDialog).toContain("UPDELED registration details are required before issuing an offer letter for D.El.Ed.");
    expect(offerLetterFunction).toContain("isDeledCourseName(course?.name) && !updeledRegistration");
    expect(offerLetterFunction).toContain("updeledRegistration: updeledRegistration || null");
  });

  it("wires counsellor entry points and sprint RPCs", () => {
    // UPDELED (and CAHET) pending badges on the lead page were unified into the
    // generalized, course-scoped ExamPendingBadge (src/lib/examRegistration.ts).
    expect(leadDetailPage).toContain("<ExamPendingBadge");
    expect(counsellorDashboard).toContain("<UpdeledSprintLeaderboard />");
    expect(updeledLeaderboard).toContain('"updeled_sprint_leaderboard"');
    expect(appRoutes).toContain('path="/updeled-sprint"');
    expect(updeledSprintPage).toContain('"updeled_sprint_queue"');
    expect(updeledSprintPage).toContain('"updeled_sprint_stats"');
    expect(updeledSprintPage).toContain('"updeled_search_pool"');
  });

  it("creates D.El.Ed-only UPDELED database primitives", () => {
    expect(migration).toContain("CREATE TABLE public.updeled_registrations");
    expect(migration).toContain("CREATE OR REPLACE VIEW public.updeled_deled_leads");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.is_deled_course");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.updeled_mark_registered");
    expect(migration).toContain("UPDELED registration is only applicable to D.El.Ed leads");
  });
});
