import { describe, expect, it } from "vitest";
import {
  ALL_APP_ROLES,
  ROLE_LABELS,
  canSeePolicyItem,
  canUsePermission,
  roleLabel,
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

  it("labels every app_role exactly once", () => {
    // ROLE_LABELS is Record<AppRole, string>, so a new enum value that reaches
    // types.ts without a label is a type error, not a silent "school_coordinator"
    // rendered as raw snake_case. These four consumers used to keep their own
    // copies and publisher/video_editor had already fallen out of most of them.
    expect(new Set(ALL_APP_ROLES).size).toBe(ALL_APP_ROLES.length);
    for (const role of ALL_APP_ROLES) expect(ROLE_LABELS[role]).toBeTruthy();
    expect(ALL_APP_ROLES).toContain("non_teaching");
    expect(ALL_APP_ROLES).toContain("publisher");
    expect(ALL_APP_ROLES).toContain("video_editor");
    expect(roleLabel("non_teaching")).toBe("Non-Teaching Staff");
    expect(roleLabel(null)).toBe("");
    expect(roleLabel("something_new")).toBe("something_new");
  });

  it("gives teacher, coordinator and non-teaching staff the right pages", () => {
    const teacher = state({
      role: "teacher",
      realRole: "teacher",
      permissions: ["dashboard:view", "students:view", "attendance:view", "attendance:mark",
        "marks:view", "marks:enter", "timetable:view", "library:view", "hr:self"],
    });
    expect(decidePermissionAccess(teacher, "students:view").allowed).toBe(true);
    expect(decidePermissionAccess(teacher, "library:view").allowed).toBe(true);
    // Class scoping is enforced by RLS (teaches_student), not by this permission.
    expect(decidePermissionAccess(teacher, "finance:view").allowed).toBe(false);
    expect(decidePermissionAccess(teacher, "user_management:view").allowed).toBe(false);
    expect(decidePermissionAccess(teacher, "timetable:edit").allowed).toBe(false);
    expect(decidePermissionAccess(teacher, "hr:view").allowed).toBe(false);

    const coordinator = state({
      role: "school_coordinator",
      realRole: "school_coordinator",
      permissions: ["dashboard:view", "students:view", "students:create", "attendance:view",
        "attendance:mark", "marks:view", "marks:enter", "marks:publish", "timetable:view",
        "timetable:edit", "timetable:substitute", "finance:view", "courses_fees:view", "hr:self"],
    });
    expect(decidePermissionAccess(coordinator, "courses_fees:view").allowed).toBe(true);
    expect(decidePermissionAccess(coordinator, "timetable:edit").allowed).toBe(true);
    expect(decidePermissionAccess(coordinator, "user_management:view").allowed).toBe(false);
    // ID Card Center is a role allow-list, not a permission.
    expect(canSeePolicyItem(coordinator, { url: "/id-card-center", roles: ["school_coordinator"] })).toBe(true);
    expect(canSeePolicyItem(teacher, { url: "/id-card-center", roles: ["school_coordinator"] })).toBe(false);

    const nonTeaching = state({
      role: "non_teaching",
      realRole: "non_teaching",
      permissions: ["hr:self"],
    });
    expect(decidePermissionAccess(nonTeaching, "hr:self").allowed).toBe(true);
    for (const locked of ["hr:view", "students:view", "finance:view", "dashboard:view", "attendance:view"]) {
      expect(decidePermissionAccess(nonTeaching, locked).allowed).toBe(false);
    }
    // Still staff — must not be bounced to a student/parent/applicant portal.
    expect(decideStaffAppAccess(nonTeaching, "/my-hr").allowed).toBe(true);
  });

  it("routes the new academic and self-service pages off the right permissions", () => {
    const teacher = state({
      role: "teacher", realRole: "teacher",
      permissions: ["students:view", "timetable:view", "attendance:view", "attendance:mark", "hr:self"],
    });
    for (const url of ["/my-classes", "/timetable", "/attendance", "/my-hr"]) {
      expect(canSeePolicyItem(teacher, { url })).toBe(true);
    }
    // The full HR module stays behind hr:view — hr:self must not unlock it.
    expect(canSeePolicyItem(teacher, { url: "/hr" })).toBe(false);
    expect(canSeePolicyItem(teacher, { url: "/hr-leave" })).toBe(false);
    expect(canSeePolicyItem(teacher, { url: "/finance" })).toBe(false);

    const nonTeaching = state({ role: "non_teaching", realRole: "non_teaching", permissions: ["hr:self"] });
    expect(canSeePolicyItem(nonTeaching, { url: "/my-hr" })).toBe(true);
    for (const url of ["/my-classes", "/timetable", "/attendance", "/hr", "/students", "/"]) {
      expect(canSeePolicyItem(nonTeaching, { url })).toBe(false);
    }
  });
});
