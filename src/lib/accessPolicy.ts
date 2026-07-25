import type { Database } from "@/integrations/supabase/types";

export type AppRole = Database["public"]["Enums"]["app_role"];

export type AccessRedirect =
  | "/login"
  | "/student"
  | "/parent"
  | "/academic-partner-portal"
  | "/forbidden"
  | "/my-applications"
  | "/";

export type AccessDeniedReason =
  | "unauthenticated"
  | "non_staff_role"
  | "academic_partner_scope"
  | "applicant_scope"
  | "wrong_role"
  | "missing_permission";

export type AccessDecision =
  | { allowed: true }
  | { allowed: false; reason: AccessDeniedReason; redirectTo: AccessRedirect };

export interface AccessState {
  isAuthenticated: boolean;
  role: AppRole | null;
  realRole: AppRole | null;
  permissions: ReadonlySet<string> | readonly string[];
  isImpersonating?: boolean;
}

export interface RoutePolicy {
  path: string;
  permission?: string;
  anyPermission?: readonly string[];
  roles?: readonly AppRole[];
  blockedRoles?: readonly AppRole[];
  staffOnly?: boolean;
}

export interface AccessPolicyItem {
  url: string;
  permission?: string;
  anyPermission?: readonly string[];
  roles?: readonly AppRole[];
  blockedRoles?: readonly AppRole[];
  hideForSuperAdmin?: boolean;
}

export const ACADEMIC_PARTNER_PORTAL_PERMISSION = "academic_partner_portal:view";
export const ACADEMIC_PARTNER_OFFER_ISSUE_PERMISSION = "academic_partner_offer_letters:issue";
export const ACADEMIC_PARTNER_ALLOWED_PERMISSIONS = new Set([ACADEMIC_PARTNER_PORTAL_PERMISSION]);
export const ACADEMIC_PARTNER_OFFER_LETTER_ALLOWED_PERMISSIONS = new Set([
  ACADEMIC_PARTNER_PORTAL_PERMISSION,
  ACADEMIC_PARTNER_OFFER_ISSUE_PERMISSION,
]);
export const ACADEMIC_PARTNER_PORTAL_ROLES = new Set<AppRole>([
  "academic_partner",
  "academic_partner_offer_letter",
]);

export function isAcademicPartnerPortalRole(role: AppRole | null): boolean {
  return role !== null && ACADEMIC_PARTNER_PORTAL_ROLES.has(role);
}

export function permissionsForAcademicPartnerRole(role: AppRole | null): readonly string[] | null {
  if (role === "academic_partner") return Array.from(ACADEMIC_PARTNER_ALLOWED_PERMISSIONS);
  if (role === "academic_partner_offer_letter") return Array.from(ACADEMIC_PARTNER_OFFER_LETTER_ALLOWED_PERMISSIONS);
  return null;
}

export const STAFF_ROUTE_POLICIES: readonly RoutePolicy[] = [
  { path: "/", permission: "dashboard:view", staffOnly: true },
  { path: "/admissions", permission: "leads:view", staffOnly: true },
  { path: "/lead-buckets", permission: "lead_buckets:view", staffOnly: true },
  { path: "/lead-assignments", permission: "leads:view", staffOnly: true },
  { path: "/lists", permission: "leads:view", blockedRoles: ["academic_partner", "academic_partner_offer_letter"], staffOnly: true },
  { path: "/marketing", permission: "leads:view", blockedRoles: ["academic_partner", "academic_partner_offer_letter"], staffOnly: true },
  { path: "/pending-followups", permission: "leads:view", staffOnly: true },
  { path: "/fresh-leads", permission: "leads:view", staffOnly: true },
  { path: "/visit-center", permission: "leads:view", staffOnly: true },
  { path: "/visit-monitor", permission: "leads:view", staffOnly: true },
  { path: "/call-log", permission: "call_log:view", staffOnly: true },
  { path: "/ai-call-log", permission: "call_log:view", staffOnly: true },
  { path: "/cloud-dialer", permission: "call_log:view", staffOnly: true },
  { path: "/cahet-sprint", permission: "call_log:view", staffOnly: true },
  { path: "/updeled-sprint", permission: "call_log:view", staffOnly: true },
  { path: "/missed-calls", permission: "call_log:view", staffOnly: true },
  { path: "/referrals", permission: "referrals:view", staffOnly: true },
  { path: "/lead-allocation", permission: "lead_allocation:view", staffOnly: true },
  { path: "/automation-rules", permission: "automation:view", staffOnly: true },
  { path: "/applications", permission: "students:view", staffOnly: true },
  { path: "/search", permission: "search:view", staffOnly: true },
  { path: "/students", permission: "students:view", staffOnly: true },
  { path: "/attendance", permission: "attendance:view", staffOnly: true },
  { path: "/finance", permission: "finance:view", staffOnly: true },
  { path: "/collections", permission: "finance:view", staffOnly: true },
  { path: "/fee-structures", permission: "courses_fees:view", staffOnly: true },
  { path: "/hr", permission: "hr:view", staffOnly: true },
  { path: "/hr-job-applicants", permission: "hr:view", staffOnly: true },
  { path: "/hr-attendance", permission: "hr:view", staffOnly: true },
  { path: "/hr-leave", permission: "hr:view", staffOnly: true },
  { path: "/hr-directory", permission: "hr:view", staffOnly: true },
  { path: "/admin", anyPermission: ["campuses_courses:view", "user_management:view", "permissions:view"], staffOnly: true },
  { path: "/id-card-center", roles: ["super_admin", "principal", "office_admin", "office_assistant", "school_coordinator", "campus_admin"], anyPermission: ["hr:view"], staffOnly: true },
  { path: "/settings", permission: "user_management:view", staffOnly: true },
  { path: "/inbox", permission: "leads:view", staffOnly: true },
  { path: "/whatsapp-inbox", permission: "whatsapp:view", staffOnly: true },
  { path: "/whatsapp-health", permission: "user_management:view", staffOnly: true },
  { path: "/template-manager", permission: "templates:view", blockedRoles: ["academic_partner", "academic_partner_offer_letter"], staffOnly: true },
  { path: "/admission-analytics", permission: "analytics:view", staffOnly: true },
  { path: "/counsellor-dashboard", permission: "performance:view", staffOnly: true },
  { path: "/reports", permission: "reports:view", staffOnly: true },
  { path: "/consultants", permission: "consultants:view", staffOnly: true },
  { path: "/academic-partners", permission: "academic_partners:view", staffOnly: true },
  { path: "/consultant-portal", permission: "consultant_portal:view", staffOnly: true },
  { path: "/academic-partner-portal", permission: ACADEMIC_PARTNER_PORTAL_PERMISSION, roles: ["academic_partner", "academic_partner_offer_letter"], staffOnly: true },
  { path: "/consultant-guide", permission: "consultant_portal:view", staffOnly: true },
  { path: "/publisher-portal", permission: "publisher_portal:view", staffOnly: true },
  { path: "/publisher-analytics", permission: "publisher_portal:view", staffOnly: true },
  { path: "/exams", permission: "exams:view", staffOnly: true },
  { path: "/documents", permission: "documents:view", staffOnly: true },
  { path: "/library", permission: "library:view", staffOnly: true },
  { path: "/my-docs", roles: ["super_admin"], staffOnly: true },
  { path: "/alumni-verifications", permission: "alumni_verification:view", staffOnly: true },
  { path: "/ib/poi", permission: "ib_poi:view", staffOnly: true },
  { path: "/ib/units", permission: "ib_units:view", staffOnly: true },
  { path: "/ib/gradebook", permission: "ib_gradebook:view", staffOnly: true },
  { path: "/ib/portfolios", permission: "ib_portfolios:view", staffOnly: true },
  { path: "/ib/action", permission: "ib_action:view", staffOnly: true },
  { path: "/ib/exhibition", permission: "ib_exhibition:view", staffOnly: true },
  { path: "/ib/reports", permission: "ib_reports:view", staffOnly: true },
  { path: "/ib/projects", permission: "ib_projects:view", staffOnly: true },
  { path: "/ib/idu", permission: "ib_idu:view", staffOnly: true },
  { path: "/video-editor", permission: "video_editor:view", staffOnly: true },
  { path: "/video-approvals", permission: "video_approval:view", staffOnly: true },
  { path: "/video-bills", permission: "video_bills:view", staffOnly: true },
];

function permissionSet(permissions: AccessState["permissions"]) {
  return permissions instanceof Set ? permissions : new Set(permissions);
}

function splitPermission(permission: string) {
  const [module, action] = permission.split(":");
  return { module, action };
}

export function isActingAsSuperAdmin(state: Pick<AccessState, "role">) {
  return state.role === "super_admin";
}

export function canUsePermission(state: AccessState, permission: string): boolean {
  if (isActingAsSuperAdmin(state)) return true;
  const partnerPermissions = permissionsForAcademicPartnerRole(state.role);
  if (partnerPermissions) return partnerPermissions.includes(permission);
  return permissionSet(state.permissions).has(permission);
}

export function canUseAnyPermission(state: AccessState, permissions: readonly string[]): boolean {
  return permissions.some((permission) => canUsePermission(state, permission));
}

export function canUseModule(state: AccessState, module: string): boolean {
  if (isActingAsSuperAdmin(state)) return true;
  const partnerPermissions = permissionsForAcademicPartnerRole(state.role);
  if (partnerPermissions) {
    for (const permission of partnerPermissions) {
      if (permission.startsWith(`${module}:`)) return true;
    }
    return false;
  }
  for (const permission of permissionSet(state.permissions)) {
    if (permission.startsWith(`${module}:`)) return true;
  }
  return false;
}

function normalizedPath(urlOrPath: string) {
  const path = urlOrPath.split("?")[0] || "/";
  return path.replace(/\/+$/, "") || "/";
}

export function routePolicyFor(path: string): RoutePolicy | null {
  const normalized = normalizedPath(path);
  let best: RoutePolicy | null = null;
  for (const policy of STAFF_ROUTE_POLICIES) {
    if (normalized === policy.path || normalized.startsWith(`${policy.path}/`)) {
      if (!best || policy.path.length > best.path.length) best = policy;
    }
  }
  return best;
}

export function decideStaffAppAccess(state: AccessState, path: string): AccessDecision {
  if (!state.isAuthenticated) {
    return { allowed: false, reason: "unauthenticated", redirectTo: "/login" };
  }
  if (state.role === "student") {
    return { allowed: false, reason: "non_staff_role", redirectTo: "/student" };
  }
  if (state.role === "parent") {
    return { allowed: false, reason: "non_staff_role", redirectTo: "/parent" };
  }
  if (state.role === null) {
    return { allowed: false, reason: "applicant_scope", redirectTo: "/my-applications" };
  }
  if (isAcademicPartnerPortalRole(state.role) && normalizedPath(path) !== "/academic-partner-portal") {
    return { allowed: false, reason: "academic_partner_scope", redirectTo: "/academic-partner-portal" };
  }
  return { allowed: true };
}

export function decidePortalRoleAccess(
  state: AccessState,
  targetRole: "student" | "parent",
): AccessDecision {
  if (!state.isAuthenticated) {
    return { allowed: false, reason: "unauthenticated", redirectTo: "/login" };
  }
  if (state.role !== targetRole) {
    return { allowed: false, reason: "wrong_role", redirectTo: "/" };
  }
  return { allowed: true };
}

export function decideApplicantAccess(state: AccessState): AccessDecision {
  if (!state.isAuthenticated) {
    return { allowed: false, reason: "unauthenticated", redirectTo: "/login" };
  }
  if (state.role !== null) {
    return { allowed: false, reason: "wrong_role", redirectTo: "/" };
  }
  return { allowed: true };
}

export function decidePermissionAccess(state: AccessState, permission: string): AccessDecision {
  if (isAcademicPartnerPortalRole(state.role) && !canUsePermission(state, permission)) {
    return { allowed: false, reason: "academic_partner_scope", redirectTo: "/academic-partner-portal" };
  }
  if (canUsePermission(state, permission)) return { allowed: true };
  return { allowed: false, reason: "missing_permission", redirectTo: "/forbidden" };
}

export function decideRoleAccess(state: AccessState, roles: readonly string[]): AccessDecision {
  if (state.role && roles.includes(state.role)) return { allowed: true };
  return { allowed: false, reason: "wrong_role", redirectTo: "/forbidden" };
}

export function decideBlockedRoleAccess(state: AccessState, roles: readonly string[]): AccessDecision {
  if (state.role && roles.includes(state.role)) {
    return { allowed: false, reason: "wrong_role", redirectTo: "/forbidden" };
  }
  return { allowed: true };
}

export function canSeePolicyItem(state: AccessState, item: AccessPolicyItem): boolean {
  if (item.hideForSuperAdmin && state.realRole === "super_admin" && !state.isImpersonating) return false;
  if (item.blockedRoles?.includes(state.role as AppRole)) return false;
  if (isAcademicPartnerPortalRole(state.role)) {
    const path = normalizedPath(item.url);
    return path === "/academic-partner-portal" || item.permission === ACADEMIC_PARTNER_PORTAL_PERMISSION;
  }

  const routePolicy = routePolicyFor(item.url);
  const roles = item.roles ?? routePolicy?.roles;
  const anyPermission = item.anyPermission ?? routePolicy?.anyPermission;
  const permission = item.permission ?? routePolicy?.permission;

  if (roles?.includes(state.role as AppRole)) return true;
  if (anyPermission && canUseAnyPermission(state, anyPermission)) return true;
  if (anyPermission && !roles && !permission) return false;
  if (roles && !permission) return false;
  if (!permission) return true;
  return canUsePermission(state, permission);
}

export function permissionFromParts(module: string, action: string) {
  return `${module}:${action}`;
}

export function canUsePermissionParts(state: AccessState, module: string, action: string) {
  return canUsePermission(state, permissionFromParts(module, action));
}

export function permissionParts(permission: string) {
  return splitPermission(permission);
}
