import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
import { readMigration } from "./readMigration";
import {
  canSeePolicyItem,
  canUsePermission,
  decideBlockedRoleAccess,
  decidePermissionAccess,
  decideStaffAppAccess,
  type AccessState,
} from "@/lib/accessPolicy";

const portal = readFileSync("src/pages/AcademicPartnerPortal.tsx", "utf8");
const manualCall = readFileSync("supabase/functions/manual-call/index.ts", "utf8");
const migration = readFileSync(
  "supabase/migrations/20260626082924_restrict_academic_partner_portal_permissions.sql",
  "utf8",
);
const offerRoleMigration = readFileSync(
  "supabase/migrations/20260703133100_academic_partner_offer_letter_role.sql",
  "utf8",
);
const offerRoleEnumMigration = readFileSync(
  "supabase/migrations/20260703133000_add_academic_partner_offer_letter_enum.sql",
  "utf8",
);
const leadAssociationMigration = readFileSync(
  "supabase/migrations/20260619121300_lead_association_approval_requests.sql",
  "utf8",
);
const studentLoginLinkMigration = readMigration("academic_partner_student_login_link");
const partnerCandidateActions = readFileSync(
  "src/components/partner/PartnerCandidateActions.tsx",
  "utf8",
);

describe("academic partner access scope", () => {
  it("hides and blocks marketing surfaces for academic partners", () => {
    const academicPartner: AccessState = {
      isAuthenticated: true,
      role: "academic_partner",
      realRole: "academic_partner",
      permissions: ["academic_partner_portal:view"],
    };

    expect(decideStaffAppAccess(academicPartner, "/academic-partner-portal")).toEqual({ allowed: true });
    expect(decideStaffAppAccess(academicPartner, "/marketing")).toEqual({
      allowed: false,
      reason: "academic_partner_scope",
      redirectTo: "/academic-partner-portal",
    });
    expect(decidePermissionAccess(academicPartner, "leads:view")).toEqual({
      allowed: false,
      reason: "academic_partner_scope",
      redirectTo: "/academic-partner-portal",
    });
    expect(decideBlockedRoleAccess(academicPartner, ["academic_partner"])).toEqual({
      allowed: false,
      reason: "wrong_role",
      redirectTo: "/forbidden",
    });
    expect(canUsePermission(academicPartner, "academic_partner_portal:view")).toBe(true);
    expect(canUsePermission(academicPartner, "templates:view")).toBe(false);
    expect(canSeePolicyItem(academicPartner, { url: "/academic-partner-portal?tab=applications" })).toBe(true);
    expect(canSeePolicyItem(academicPartner, { url: "/academic-partner-portal?tab=fees" })).toBe(true);
    expect(canSeePolicyItem(academicPartner, { url: "/lists", permission: "leads:view", blockedRoles: ["academic_partner", "academic_partner_offer_letter"] })).toBe(false);
    expect(canSeePolicyItem(academicPartner, { url: "/marketing", permission: "leads:view", blockedRoles: ["academic_partner", "academic_partner_offer_letter"] })).toBe(false);
    expect(canSeePolicyItem(academicPartner, { url: "/template-manager", permission: "templates:view", blockedRoles: ["academic_partner", "academic_partner_offer_letter"] })).toBe(false);
  });

  it("lets the offer-letter partner role issue offers but keeps it in the partner portal", () => {
    const offerPartner: AccessState = {
      isAuthenticated: true,
      role: "academic_partner_offer_letter",
      realRole: "academic_partner_offer_letter",
      permissions: ["academic_partner_portal:view", "academic_partner_offer_letters:issue"],
    };

    expect(decideStaffAppAccess(offerPartner, "/academic-partner-portal")).toEqual({ allowed: true });
    expect(decideStaffAppAccess(offerPartner, "/applications")).toEqual({
      allowed: false,
      reason: "academic_partner_scope",
      redirectTo: "/academic-partner-portal",
    });
    expect(canUsePermission(offerPartner, "academic_partner_portal:view")).toBe(true);
    expect(canUsePermission(offerPartner, "academic_partner_offer_letters:issue")).toBe(true);
    expect(canUsePermission(offerPartner, "leads:view")).toBe(false);
  });

  it("keeps academic partners inside their dedicated portal instead of full CRM lead detail", () => {
    expect(portal).not.toContain('navigate(`/admissions/${lead.id}`)');
    expect(portal).not.toContain('useNavigate');
  });

  it("shows student-wise fee collection and academic attendance records inside the partner portal", () => {
    expect(portal).toContain("useSearchParams");
    expect(portal).toContain("PORTAL_TABS");
    expect(portal).toContain("setSearchParams");
    expect(portal).toContain('label: "Fee Collection", value: "fees"');
    expect(portal).toContain('label: "Academic Record", value: "attendance"');
    expect(portal).toContain("feeByStudent");
    expect(portal).toContain("attendanceByStudent");
    expect(portal).toContain("No fee collection found for assigned candidates");
    expect(portal).toContain("assignmentMatchesStudent");
    expect(portal).toContain('.eq("course_id", assignment.course_id)');
    expect(portal).toContain('.eq("batch_id", assignment.batch_id)');
    expect(portal).toContain('.in("student_id", scopedStudentIds)');
    expect(portal).toContain('.in("student_id", feeStudentIds)');
    expect(portal).not.toContain('supabase.from("students").select("id, name, admission_no, phone, status, courses:course_id(name), batches:batch_id(name)").order("created_at"');
    expect(portal).not.toContain('supabase.from("fee_ledger").select("id, student_id, term, total_amount, paid_amount, balance, status, students:student_id(name, admission_no, pre_admission_no)").order("due_date"');
  });

  it("shows application status and a direct login link action for assigned leads", () => {
    expect(portal).toContain("ApplyMagicLinkButton");
    expect(portal).toContain('label: "Applications", value: "applications"');
    expect(portal).toContain('<TabsContent value="applications"');
    expect(portal).toContain("application_stage");
    expect(portal).toContain("application_status");
    expect(portal).toContain("application_payment_status");
    expect(portal).toContain("Send Login Link");
    expect(portal).not.toContain("setDetailsLead");
    // `directOpen` went with the on-behalf buttons; the login link is now the
    // only ApplyMagicLinkButton use, driven as a controlled share dialog.
    expect(portal).toContain("controlledOpen");
    expect(portal.match(/ApplyMagicLinkButton/g)?.length || 0).toBeGreaterThanOrEqual(3);
  });

  it("keeps leads and applications scoped to the mapped academic partner", () => {
    expect(portal).toContain("LeadPipeline");
    expect(portal).toContain("ApplicationFunnelStrip");
    expect(portal).toContain("ACADEMIC_PARTNER_PIPELINE_LEAD_SELECT");
    expect(portal).toContain("source, academic_partner_id");
    expect(portal).toContain("scopePartnerPipelineLeads");
    expect(portal).toContain("lead.academic_partner_id === partnerId");
    expect(portal).toContain('.eq("academic_partner_id", partnerId)');
    expect(portal).toContain("Partner-created new leads are mapped on insert");
    expect(portal).toContain("duplicate existing CRM leads");
    expect(portal).toContain("applicationLeads");
    expect(portal).toContain("No applications found for assigned leads");
    expect(portal).toContain("academic_partner_paid_applications");
    expect(portal).toContain("Attribution");
    expect(portal).toContain("Not attributed to you");
    expect(leadAssociationMigration).toContain("v_existing_lead_id IS NULL");
    expect(leadAssociationMigration).toContain("CASE WHEN _requester_type = 'academic_partner' THEN _academic_partner_id ELSE NULL END");
    expect(leadAssociationMigration).toContain("'status', 'pending'");
  });

  it("allows cloud calls from the portal only through scoped manual-call authorization", () => {
    expect(portal).toContain('supabase.functions.invoke("manual-call"');
    expect(portal).toContain("placeCloudCall(lead)");
    expect(portal).toContain("Cloud Call");
    expect(manualCall).toContain('callerDb.auth.getUser()');
    expect(manualCall).toContain('callerRole === "academic_partner" || callerRole === "academic_partner_offer_letter"');
    expect(manualCall).toContain("can_academic_partner_view_mapped_lead");
    expect(manualCall).toContain("You can call only leads assigned to your academic partner account.");
  });

  it("lets academic partners set their own cloud call agent number in portal settings", () => {
    expect(portal).toContain('label: "Settings", value: "settings"');
    expect(portal).toContain("Cloud Call Settings");
    expect(portal).toContain("Calling agent number");
    expect(portal).toContain("saveCallingAgentPhone");
    expect(portal).toContain('.from("profiles")');
    expect(portal).toContain(".update({ phone: normalized })");
    expect(portal).toContain('.eq("user_id", user.id)');
  });

  it("removes broad role permissions while preserving the portal grant", () => {
    expect(migration).toContain("DELETE FROM public.role_permissions");
    expect(migration).toContain("('leads', 'view')");
    expect(migration).toContain("('finance', 'view')");
    expect(migration).toContain("('students', 'view')");
    expect(migration).toContain("('academic_partner_portal', 'view')");
  });

  it("scopes students by batch and financial rows by mapped lead ownership", () => {
    expect(migration).toContain("public.is_academic_partner_scope(auth.uid(), course_id, batch_id)");
    expect(migration).toContain("public.can_academic_partner_view_fee_student(auth.uid(), student_id)");
    expect(migration).toContain("public.can_academic_partner_view_mapped_lead(auth.uid(), lead_id)");
  });

  it("adds server-side paid application and offer issuance gates for the offer-letter role", () => {
    expect(offerRoleEnumMigration).toContain("ALTER TYPE public.app_role");
    expect(offerRoleMigration).toContain("academic_partner_offer_letters");
    expect(offerRoleMigration).toContain("CREATE OR REPLACE FUNCTION public.academic_partner_paid_applications");
    expect(offerRoleMigration).toContain("a.payment_status = 'paid'");
    expect(offerRoleMigration).toContain("CREATE OR REPLACE FUNCTION public.academic_partner_issue_offer");
    expect(offerRoleMigration).toContain("Only academic partner offer-letter users can issue offers");
    expect(offerRoleMigration).toContain("Application fee is not paid");
    expect(offerRoleMigration).toContain("Application is outside academic partner assigned course scope");
    expect(offerRoleMigration).toContain("'offer_issued_by_partner'");
  });

  it("keeps partner-converted students visible even without a course assignment", () => {
    // Regression: `students` used to be set from scopedStudentRows only
    // (course/batch ASSIGNMENT matches). Fees/receipts are keyed off the
    // partner's own leads, so a converted student with no active assignment
    // vanished from the Students tab and the fee-details dialog silently
    // rendered "No fee receipts recorded yet". Union both sets.
    expect(portal).toContain("uniqueById([...scopedStudentRows, ...mappedStudentRows])");
    // The lead-derived student query must select full columns (course_id,
    // batch_id, lead_id, etc.) — not just id/lead_id — so the union entries
    // render name/course/batch correctly in the Students tab.
    expect(portal).not.toContain('.select("id, lead_id")');
    // fee_code_id is needed to build payment-link allocations for a student.
    expect(portal).toContain("fee_code_id, students:student_id(name, admission_no, pre_admission_no)");
  });

  it("adds shared per-stage partner actions (candidate actions, receipts, login link)", () => {
    expect(portal).toContain(
      'PartnerReceiptsTable,\n  PartnerCandidateActions,\n  StudentLoginLinkDialog,\n} from "@/components/partner/PartnerCandidateActions";',
    );
    expect(portal.match(/<PartnerCandidateActions/g)?.length || 0).toBeGreaterThanOrEqual(3);
    expect(portal).toContain("<PartnerReceiptsTable receipts={feeDetailsReceipts}");
    expect(portal).toContain("<StudentLoginLinkDialog");
    // The students-stage payment link is a fee-due collection, not a token.
    expect(portal).toContain('studentId={payLinkStudent.id}');
    expect(portal).toContain('defaultPurpose="fee_due"');
    expect(partnerCandidateActions).toContain("export function PartnerReceiptsTable");
    expect(partnerCandidateActions).toContain("export type FeeReceipt");
  });

  it("widens the student login-link guards without dropping the cashier/super_admin branches", () => {
    expect(studentLoginLinkMigration).toContain("CREATE OR REPLACE FUNCTION public.issue_student_login_link");
    expect(studentLoginLinkMigration).toContain("CREATE OR REPLACE FUNCTION public.send_student_login_link");
    const guardCount = (studentLoginLinkMigration.match(/can_academic_partner_view_fee_student\(auth\.uid\(\), /g) || []).length;
    expect(guardCount).toBe(2);
    const collectFeeCount = (studentLoginLinkMigration.match(/public\.can_collect_fee\(auth\.uid\(\)\)/g) || []).length;
    expect(collectFeeCount).toBe(2);
    const superAdminCount = (studentLoginLinkMigration.match(/public\.has_role\(auth\.uid\(\), 'super_admin'\)/g) || []).length;
    expect(superAdminCount).toBe(2);
  });

  it("splits the Students tab into Token Paid/Pre-Admitted/Admitted, deriving all three from one unified candidateRows list", () => {
    // Sub-tabs exist, defaulting to the first non-empty bucket in Token Paid → Pre-Admitted → Admitted order.
    expect(portal).toContain(
      'defaultValue={tokenPaidRows.length > 0 ? "token_paid" : preAdmittedRows.length > 0 ? "pre_admitted" : "admitted"}',
    );
    expect(portal).toContain("Token Paid ({tokenPaidRows.length})");
    expect(portal).toContain("Pre-Admitted ({preAdmittedRows.length})");
    expect(portal).toContain("Admitted ({admittedRows.length})");
    expect(portal).toContain("No admitted students yet");
    expect(portal).toContain("No pre-admitted candidates yet");
    expect(portal).toContain("No token-paid candidates yet");
    // candidateRows unifies partner-attributed leads with assignment-scoped
    // students not covered by a lead, so a candidate with no `students` row at
    // all (paid a token/part fee, no admission number) still shows up.
    expect(portal).toContain("const candidateRows = useMemo(() => {");
    expect(portal).toContain("const rows: CandidateRow[] = [];");
    // Qualifies on receipt `type` !== application_fee, not has_token_fee_paid,
    // so pre_admission_token / registration_fee / other payments also count.
    expect(portal).toContain('const hasNonApplicationFeePayment = receipts.some((r) => r.type !== "application_fee");');
    expect(portal).not.toContain("return lead.has_token_fee_paid");
    // Buckets are mutually exclusive and derived off candidateRows.
    expect(portal).toContain(
      "const admittedRows = useMemo(() => candidateRows.filter((row) => Boolean(row.admissionNo)), [candidateRows]);",
    );
    expect(portal).toContain("candidateRows.filter((row) => !row.admissionNo && Boolean(row.pan))");
    expect(portal).toContain("candidateRows.filter((row) => !row.admissionNo && !row.pan)");
  });

  it("bucket (b): a non-attributed (teaching-only) student is bucketed by admission no and rendered with the Direct badge", () => {
    // Students not covered by a partner-attributed lead are still added to
    // candidateRows, marked attributed: false, keyed by lead id when present
    // else the student id.
    expect(portal).toContain("if (student.lead_id && coveredLeadIds.has(student.lead_id)) return;");
    expect(portal).toContain("key: student.lead_id ?? student.id,");
    expect(portal).toContain("admissionNo: student.admission_no,");
    expect(portal).toContain("attributed: false,");
    // Every candidate table renders a Direct badge next to the name for
    // non-attributed rows, using the shared ATTRIBUTION_LABELS.direct text.
    expect(portal.match(/<DirectBadge attributed=\{row\.attributed\} \/>/g)?.length || 0).toBeGreaterThanOrEqual(3);
    expect(portal).toContain('attributionBadge("direct")');
    expect(portal).toContain("{ATTRIBUTION_LABELS.direct}");
    expect(portal).toContain('title="Not attributed to you — not counted for payout"');
  });
});
