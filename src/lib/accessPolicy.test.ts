import { describe, expect, it } from "vitest";
import {
  canSeePolicyItem,
  canUsePermission,
  decideBlockedRoleAccess,
  decidePermissionAccess,
  decidePortalRoleAccess,
  decideStaffAppAccess,
  type AccessState,
} from "@/lib/accessPolicy";

const state = (overrides: Partial<AccessState>): AccessState => ({
  isAuthenticated: true,
  role: "counsellor",
  realRole: "counsellor",
  permissions: ["leads:view", "call_log:view"],
  ...overrides,
});

describe("accessPolicy", () => {
  it("uses effective impersonated role instead of real super_admin for permissions", () => {
    const impersonatingAcademicPartner = state({
      role: "academic_partner",
      realRole: "super_admin",
      permissions: ["leads:view", "user_management:view"],
      isImpersonating: true,
    });

    expect(canUsePermission(impersonatingAcademicPartner, "academic_partner_portal:view")).toBe(true);
    expect(canUsePermission(impersonatingAcademicPartner, "leads:view")).toBe(false);
    expect(decidePermissionAccess(impersonatingAcademicPartner, "leads:view")).toEqual({
      allowed: false,
      reason: "academic_partner_scope",
      redirectTo: "/academic-partner-portal",
    });
  });

  it("keeps academic partners inside their portal", () => {
    const academicPartner = state({
      role: "academic_partner",
      realRole: "academic_partner",
      permissions: ["academic_partner_portal:view"],
    });

    expect(decideStaffAppAccess(academicPartner, "/academic-partner-portal")).toEqual({ allowed: true });
    expect(decideStaffAppAccess(academicPartner, "/marketing")).toEqual({
      allowed: false,
      reason: "academic_partner_scope",
      redirectTo: "/academic-partner-portal",
    });
    expect(canSeePolicyItem(academicPartner, { url: "/marketing", permission: "leads:view" })).toBe(false);
    expect(canSeePolicyItem(academicPartner, { url: "/academic-partner-portal?tab=fees" })).toBe(true);
  });

  it("keeps offer-letter academic partners portal-scoped with only the issue-offer capability added", () => {
    const baseAcademicPartner = state({
      role: "academic_partner",
      realRole: "academic_partner",
      permissions: ["academic_partner_portal:view", "academic_partner_offer_letters:issue", "leads:view"],
    });
    const offerAcademicPartner = state({
      role: "academic_partner_offer_letter",
      realRole: "academic_partner_offer_letter",
      permissions: ["academic_partner_portal:view", "academic_partner_offer_letters:issue", "leads:view"],
    });

    expect(canUsePermission(baseAcademicPartner, "academic_partner_portal:view")).toBe(true);
    expect(canUsePermission(baseAcademicPartner, "academic_partner_offer_letters:issue")).toBe(false);
    expect(canUsePermission(baseAcademicPartner, "leads:view")).toBe(false);
    expect(decidePermissionAccess(baseAcademicPartner, "academic_partner_offer_letters:issue")).toEqual({
      allowed: false,
      reason: "academic_partner_scope",
      redirectTo: "/academic-partner-portal",
    });

    expect(canUsePermission(offerAcademicPartner, "academic_partner_portal:view")).toBe(true);
    expect(canUsePermission(offerAcademicPartner, "academic_partner_offer_letters:issue")).toBe(true);
    expect(canUsePermission(offerAcademicPartner, "leads:view")).toBe(false);
    expect(decidePermissionAccess(offerAcademicPartner, "academic_partner_offer_letters:issue")).toEqual({ allowed: true });
    expect(decideStaffAppAccess(offerAcademicPartner, "/applications")).toEqual({
      allowed: false,
      reason: "academic_partner_scope",
      redirectTo: "/academic-partner-portal",
    });
    expect(canSeePolicyItem(offerAcademicPartner, { url: "/applications", permission: "students:view" })).toBe(false);
    expect(canSeePolicyItem(offerAcademicPartner, { url: "/academic-partner-portal?tab=applications" })).toBe(true);
  });

  it("allows counsellors to use admissions and call-log surfaces without admin access", () => {
    const counsellor = state({
      role: "counsellor",
      realRole: "counsellor",
      permissions: ["leads:view", "call_log:view", "lead_buckets:view"],
    });

    expect(decideStaffAppAccess(counsellor, "/admissions")).toEqual({ allowed: true });
    expect(decidePermissionAccess(counsellor, "leads:view")).toEqual({ allowed: true });
    expect(decidePermissionAccess(counsellor, "call_log:view")).toEqual({ allowed: true });
    expect(decidePermissionAccess(counsellor, "user_management:view")).toEqual({
      allowed: false,
      reason: "missing_permission",
      redirectTo: "/forbidden",
    });
    expect(canSeePolicyItem(counsellor, { url: "/cloud-dialer", permission: "call_log:view" })).toBe(true);
    expect(canSeePolicyItem(counsellor, { url: "/admin", anyPermission: ["user_management:view"] })).toBe(false);
  });

  it("allows admission heads to use admissions management surfaces", () => {
    const admissionHead = state({
      role: "admission_head",
      realRole: "admission_head",
      permissions: [
        "leads:view",
        "call_log:view",
        "lead_allocation:view",
        "automation:view",
        "performance:view",
        "analytics:view",
        "templates:view",
      ],
    });

    expect(decidePermissionAccess(admissionHead, "lead_allocation:view")).toEqual({ allowed: true });
    expect(decidePermissionAccess(admissionHead, "automation:view")).toEqual({ allowed: true });
    expect(canSeePolicyItem(admissionHead, { url: "/lead-allocation", permission: "lead_allocation:view" })).toBe(true);
    expect(canSeePolicyItem(admissionHead, { url: "/template-manager", permission: "templates:view" })).toBe(true);
    expect(canSeePolicyItem(admissionHead, { url: "/finance", permission: "finance:view" })).toBe(false);
  });

  it("does not let real super_admin bypass role checks while impersonating student or parent", () => {
    const impersonatingStudent = state({
      role: "student",
      realRole: "super_admin",
      permissions: ["*"],
      isImpersonating: true,
    });

    expect(decideStaffAppAccess(impersonatingStudent, "/")).toEqual({
      allowed: false,
      reason: "non_staff_role",
      redirectTo: "/student",
    });
    expect(decidePortalRoleAccess(impersonatingStudent, "student")).toEqual({ allowed: true });
    expect(decidePortalRoleAccess(impersonatingStudent, "parent")).toEqual({
      allowed: false,
      reason: "wrong_role",
      redirectTo: "/",
    });
  });

  it("does not widen a menu item's own roles with the route's permission", () => {
    // /visit-monitor is RequireRole(super_admin/principal/admission_head) in
    // App.tsx. Its route policy used to carry permission: leads:view, which
    // every counsellor has — so the sidebar rendered a link that 403s.
    const counsellor = state({ role: "counsellor", realRole: "counsellor" });
    expect(canSeePolicyItem(counsellor, {
      title: "Visit Monitor",
      url: "/visit-monitor",
      roles: ["super_admin", "principal", "admission_head"],
    } as never)).toBe(false);

    const head = state({ role: "admission_head", realRole: "admission_head" });
    expect(canSeePolicyItem(head, {
      title: "Visit Monitor",
      url: "/visit-monitor",
      roles: ["super_admin", "principal", "admission_head"],
    } as never)).toBe(true);
  });

  it("hides the calling sprints from counsellors", () => {
    const counsellor = state({ role: "counsellor", realRole: "counsellor" });
    // They hold call_log:view, so only blockedRoles keeps these out.
    expect(canSeePolicyItem(counsellor, {
      title: "CAHET Sprint",
      url: "/cahet-sprint",
      permission: "call_log:view",
      blockedRoles: ["counsellor"],
    } as never)).toBe(false);
  });

  it("separates the consultants directory from consultant attribution", () => {
    // consultants:view is no longer granted to the counsellor role — it is
    // per-user now (20260803095753). Counsellors keep lead-to-consultant
    // attribution through leads:assign_external_owner, which is an independent
    // branch of can_assign_lead_external_owner, so revoking the directory does
    // not silently break commission attribution.
    const counsellor = state({ permissions: ["leads:view", "leads:assign_external_owner"] });
    expect(canSeePolicyItem(counsellor, {
      title: "Consultants", url: "/consultants", permission: "consultants:view",
    } as never)).toBe(false);
    expect(canUsePermission(counsellor, "leads:assign_external_owner")).toBe(true);
  });

  it("keeps Consultants visible to counsellors who hold the permission", () => {
    const withPerm = state({ permissions: ["leads:view", "consultants:view"] });
    expect(canSeePolicyItem(withPerm, {
      title: "Consultants", url: "/consultants", permission: "consultants:view",
    } as never)).toBe(true);

    const withoutPerm = state({ permissions: ["leads:view"] });
    expect(canSeePolicyItem(withoutPerm, {
      title: "Consultants", url: "/consultants", permission: "consultants:view",
    } as never)).toBe(false);
  });

  it("blocks roles through the effective role", () => {
    const impersonatingAcademicPartner = state({
      role: "academic_partner",
      realRole: "super_admin",
      isImpersonating: true,
    });

    expect(decideBlockedRoleAccess(impersonatingAcademicPartner, ["academic_partner"])).toEqual({
      allowed: false,
      reason: "wrong_role",
      redirectTo: "/forbidden",
    });
  });
});
