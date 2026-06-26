import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const adminApplicationView = readFileSync("src/pages/AdminApplicationView.tsx", "utf8");
const docReviewPanel = readFileSync("src/components/admissions/DocReviewPanel.tsx", "utf8");
const listAppDocs = readFileSync("supabase/functions/list-app-docs/index.ts", "utf8");
const applyPortalUploadDoc = readFileSync("supabase/functions/apply-portal-upload-doc/index.ts", "utf8");
const generateApplicationForm = readFileSync("supabase/functions/generate-application-form/index.ts", "utf8");
const generateOfferLetter = readFileSync("supabase/functions/generate-offer-letter/index.ts", "utf8");
const migration = readFileSync("supabase/migrations/20260619120700_restrict_application_doc_review_approvals.sql", "utf8");
const principalOnlyMigration = readFileSync("supabase/migrations/20260620117000_principal_superadmin_document_review_only.sql", "utf8");
const applicationDecisionGuard = readFileSync("supabase/migrations/20260620118000_guard_application_decision_roles.sql", "utf8");
const activeDocGateMigration = readFileSync("supabase/migrations/20260624151000_active_doc_review_status_for_an_gate.sql", "utf8");

describe("application document review access", () => {
  it("keeps document approval controls read-only for non-approvers", () => {
    expect(adminApplicationView).toContain('const canApproveApplication = role === "super_admin" || role === "principal"');
    expect(adminApplicationView).toContain("readOnly={decided || !canApproveApplication}");
    expect(adminApplicationView).toContain("readOnlyReason={!canApproveApplication");
    expect(adminApplicationView).toContain("Only principals and super admins can approve or reject documents.");
    expect(docReviewPanel).toContain("readOnlyReason");
  });

  it("keeps counsellor document review approval blocked at the database layer", () => {
    expect(migration).toContain('DROP POLICY IF EXISTS "staff manage app doc reviews"');
    expect(migration).toContain('CREATE POLICY "staff can view app doc reviews"');
    expect(migration).toContain("'counsellor'");

    const writePolicyBlock = principalOnlyMigration.slice(principalOnlyMigration.indexOf('CREATE POLICY "approvers can insert app doc reviews"'));
    expect(writePolicyBlock).toContain("public.has_role(auth.uid(), 'super_admin')");
    expect(writePolicyBlock).toContain("public.has_role(auth.uid(), 'principal')");
    expect(writePolicyBlock).not.toContain("JOIN public.teams");
    expect(writePolicyBlock).not.toContain("'counsellor'");
  });

  it("allows counsellors to upload documents without granting approval controls", () => {
    expect(adminApplicationView).toContain('const canUploadDocuments = role === "super_admin" || role === "principal" || role === "counsellor"');
    expect(adminApplicationView).toContain("<DocumentUpload");
    expect(adminApplicationView).toContain('nextLabel="Refresh document list"');
    expect(adminApplicationView).toContain('storageTarget="supabase"');
  });

  it("blocks counsellors from application approval at the database layer", () => {
    expect(adminApplicationView).toContain('onApprove={canApproveApplication && app.status === "submitted"');
    expect(applicationDecisionGuard).toContain("guard_application_decision_roles");
    expect(applicationDecisionGuard).toContain("Only principals and super admins can approve or reject applications");
    expect(applicationDecisionGuard).toContain("public.has_role(auth.uid(), 'super_admin')");
    expect(applicationDecisionGuard).toContain("public.has_role(auth.uid(), 'principal')");
    expect(applicationDecisionGuard).not.toContain("'counsellor'");
  });

  it("records and displays reviewer names for document and application decisions", () => {
    expect(adminApplicationView).toContain("insertApplicationAudit");
    expect(adminApplicationView).toContain("reviewed_by_name");
    expect(adminApplicationView).toContain("setApplicationApproverName");
    expect(docReviewPanel).toContain("Verified by");
  });

  it("offers a repair path for applications whose lead was deleted", () => {
    expect(adminApplicationView).toContain("createLinkedLead");
    expect(adminApplicationView).toContain("Create Linked Lead");
    expect(adminApplicationView).toContain("Lead created and linked from orphan application");
    expect(adminApplicationView).toContain("issueOfferOrRepairLead");
    expect(adminApplicationView).toContain("Create Lead & Issue Offer");
    expect(docReviewPanel).toContain("Waiting for the applicant to re-upload this document");
    expect(readFileSync("src/components/admissions/AdmissionLifecycleStepper.tsx", "utf8")).toContain("Create Lead & Issue Offer");
  });

  it("does not allow staff to verify or re-reject an already rejected document", () => {
    expect(docReviewPanel).toContain('activeStatus === "rejected"');
    expect(docReviewPanel).toContain("Waiting for the applicant to re-upload this document");
    expect(docReviewPanel).not.toContain("Update rejection");
  });

  it("treats a replacement upload as the active document for review", () => {
    expect(listAppDocs).toContain("application_documents");
    expect(listAppDocs).toContain("latestByDocKey");
    expect(listAppDocs).toContain("doc_key");
    expect(listAppDocs).toContain("uploaded_at");
    expect(listAppDocs).toContain("staleReviewPaths");
    expect(listAppDocs).toContain("review_status");
    expect(listAppDocs).toContain("review_notes");
    expect(adminApplicationView).toContain("activeDocPaths");
    expect(adminApplicationView).toContain("activeDocsByLogicalKey");
    expect(adminApplicationView).toContain("docStatusRank");
    expect(adminApplicationView).toContain("if (activeDocPaths.has(r.file_path))");
  });

  it("uses fresh object keys and no-cache headers for document replacements", () => {
    expect(applyPortalUploadDoc).toContain("const uploadId = new Date().toISOString()");
    expect(applyPortalUploadDoc).toContain("passport_photo.${uploadId}.${extension}");
    expect(applyPortalUploadDoc).toContain("${docKey}-${uploadId}-");
    expect(applyPortalUploadDoc).toContain('cacheControl: "no-cache, max-age=0"');
  });

  it("routes applicant uploads and generated admission PDFs through R2", () => {
    expect(applyPortalUploadDoc).toContain("uploadToR2");
    expect(applyPortalUploadDoc).toContain("application-portal/");
    expect(applyPortalUploadDoc).toContain("application_documents");
    expect(generateApplicationForm).toContain("uploadToR2");
    expect(generateApplicationForm).toContain("application-pdfs/");
    expect(generateOfferLetter).toContain("uploadToR2");
    expect(generateOfferLetter).toContain("offer-letters/");
  });

  it("blocks AN only when the latest review for a logical document is rejected", () => {
    expect(activeDocGateMigration).toContain("CREATE OR REPLACE FUNCTION public.application_doc_key");
    expect(activeDocGateMigration).toContain("PARTITION BY a.application_id, public.application_doc_key(r.file_path)");
    expect(activeDocGateMigration).toContain("row_number() OVER");
    expect(activeDocGateMigration).toContain("WHERE review_rank = 1");
    expect(activeDocGateMigration).toContain("AND status = 'rejected'");
  });
});
