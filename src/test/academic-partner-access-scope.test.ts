import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";
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
    expect(portal).toContain("Application Stage");
    expect(portal).toContain("application_status");
    expect(portal).toContain("application_payment_status");
    expect(portal).toContain("View details");
    expect(portal).toContain("directOpen");
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
});
