import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync("supabase/migrations/20260629020000_apply_lead_transition_command.sql", "utf8");

const staffLifecycleFiles = [
  "src/pages/LeadDetail.tsx",
  "src/pages/CloudDialer.tsx",
  "src/pages/CahetSprint.tsx",
  "src/pages/UpdeledSprint.tsx",
  "src/pages/PendingFollowups.tsx",
  "src/pages/WhatsAppInbox.tsx",
  "src/pages/AdminApplicationView.tsx",
  "src/components/admissions/OfferLetterDialog.tsx",
  "src/components/admissions/InterviewScoringDialog.tsx",
  "src/components/admissions/ConvertToStudentDialog.tsx",
];

describe("staff lead transition command module", () => {
  it("keeps staff browser lifecycle writes behind the server command interface", () => {
    for (const file of staffLifecycleFiles) {
      const source = readFileSync(file, "utf8");
      expect(source, `${file} should use the command module`).toContain("applyResolvedLeadTransition");
      expect(source, `${file} should not use legacy lead stage patch helper`).not.toContain("leadTransitionStagePatch");
      expect(source, `${file} should not directly write staff lifecycle stages`).not.toMatch(
        /from\(["']leads["']\)\s*\.update\(\s*\{[^}]*stage\s*:/s,
      );
    }
  });

  it("defines an authenticated server command with audit locality", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.apply_lead_transition_command");
    expect(migration).toContain("SECURITY DEFINER");
    expect(migration).toContain("auth.uid() IS NULL");
    expect(migration).toContain("leads:edit");
    expect(migration).toContain("INSERT INTO public.lead_activities");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.apply_lead_transition_command");
  });

  it("covers workflow, disposition, approval, and conversion command names", () => {
    for (const command of [
      "recordDispositionInterested",
      "recordDispositionNotInterested",
      "recordDispositionDeferred",
      "scheduleVisit",
      "rescheduleVisit",
      "issueOffer",
      "markDnc",
      "restoreFromDnc",
      "classifyInactive",
      "submitApplication",
      "approveApplication",
      "recordInterviewPassed",
      "convertPreAdmitted",
      "convertAdmitted",
    ]) {
      expect(migration).toContain(command);
    }
  });
});
