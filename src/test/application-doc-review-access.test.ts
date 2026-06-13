import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const adminApplicationView = readFileSync("src/pages/AdminApplicationView.tsx", "utf8");
const docReviewPanel = readFileSync("src/components/admissions/DocReviewPanel.tsx", "utf8");
const listAppDocs = readFileSync("supabase/functions/list-app-docs/index.ts", "utf8");
const migration = readFileSync("supabase/migrations/20260619101000_restrict_application_doc_review_approvals.sql", "utf8");

describe("application document review access", () => {
  it("keeps document approval controls read-only for non-approvers", () => {
    expect(adminApplicationView).toContain("useIsTeamLeader");
    expect(adminApplicationView).toContain('role === "super_admin" || role === "principal" || isTeamLeader');
    expect(adminApplicationView).toContain("readOnly={decided || !canApproveApplication}");
    expect(adminApplicationView).toContain("readOnlyReason={!canApproveApplication");
    expect(adminApplicationView).toContain("Only team leaders, principals, and super admins can approve or reject documents.");
    expect(docReviewPanel).toContain("readOnlyReason");
  });

  it("keeps counsellor document review access view-only at the database layer", () => {
    expect(migration).toContain('DROP POLICY IF EXISTS "staff manage app doc reviews"');
    expect(migration).toContain('CREATE POLICY "staff can view app doc reviews"');
    expect(migration).toContain("'counsellor'");

    const writePolicyBlock = migration.slice(migration.indexOf('CREATE POLICY "approvers can insert app doc reviews"'));
    expect(writePolicyBlock).toContain("public.has_role(auth.uid(), 'super_admin')");
    expect(writePolicyBlock).toContain("public.has_role(auth.uid(), 'principal')");
    expect(writePolicyBlock).toContain("JOIN public.teams t ON t.leader_id = p.id");
    expect(writePolicyBlock).not.toContain("'counsellor'");
  });

  it("does not allow staff to verify or re-reject an already rejected document", () => {
    expect(docReviewPanel).toContain('activeStatus === "rejected"');
    expect(docReviewPanel).toContain("Waiting for the applicant to re-upload this document");
    expect(docReviewPanel).not.toContain("Update rejection");
  });

  it("treats a replacement upload as the active document for review", () => {
    expect(listAppDocs).toContain("latestByDocKey");
    expect(listAppDocs).toContain("staleReviewPaths");
    expect(adminApplicationView).toContain("activeDocPaths");
    expect(adminApplicationView).toContain("if (activeDocPaths.has(r.file_path))");
  });
});
