import { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { usePermissions } from "@/contexts/PermissionContext";
import { OrbLoader } from "@/components/ui/thinking-orb";
import { PageLoader } from "@/components/ui/page-loader";
import {
  decideApplicantAccess,
  decideBlockedRoleAccess,
  decidePermissionAccess,
  decidePortalRoleAccess,
  decideRoleAccess,
  decideStaffAppAccess,
  type AccessDecision,
  type AccessState,
} from "@/lib/accessPolicy";

// Pre-shell gates run before AppLayout exists, so they own the whole viewport.
const Spinner = () => (
  <div className="flex h-screen items-center justify-center bg-background">
    <OrbLoader state="working" label="Loading…" />
  </div>
);

// RequirePermission is the one gate that renders INSIDE AppLayout's
// <main className="overflow-auto p-6">, where an h-screen child forces a
// scrollbar and pushes the orb below the fold. Render the same surface the
// shell is about to render instead — the handoff becomes invisible.
const InShellSpinner = () => <PageLoader />;

const renderDecision = (decision: AccessDecision, children: ReactNode) => {
  if (decision.allowed) return <>{children}</>;
  return <Navigate to={decision.redirectTo} replace />;
};

// ── ProtectedRoute ──────────────────────────────────────────────────────────
// Legacy: kept for backward compat on routes that don't need role segmentation.
// Prefer StaffRoute for the main staff app catchall.
export const ProtectedRoute = ({ children }: { children: ReactNode }) => {
  const { session, role, realRole, permissions, isImpersonating, loading, roleLoaded } = useAuth();
  if (loading || !roleLoaded) return <Spinner />;
  return renderDecision(decideStaffAppAccess({
    isAuthenticated: !!session,
    role,
    realRole,
    permissions,
    isImpersonating,
  }, "/"), children);
};

// ── StaffRoute ──────────────────────────────────────────────────────────────
// For the main /* staff catchall. Blocks student/parent roles from entering
// the staff app and routes them to their own portals instead.
export const StaffRoute = ({ children }: { children: ReactNode }) => {
  const { session, role, realRole, permissions, isImpersonating, loading, roleLoaded } = useAuth();
  const location = useLocation();
  if (loading || !roleLoaded) return <Spinner />;
  return renderDecision(decideStaffAppAccess({
    isAuthenticated: !!session,
    role,
    realRole,
    permissions,
    isImpersonating,
  }, location.pathname), children);
};

// ── StudentRoute ────────────────────────────────────────────────────────────
// Only allows users with role=student (or super_admin impersonating one).
export const StudentRoute = ({ children }: { children: ReactNode }) => {
  const { session, role, realRole, permissions, isImpersonating, loading, roleLoaded } = useAuth();
  if (loading || !roleLoaded) return <Spinner />;
  return renderDecision(decidePortalRoleAccess({
    isAuthenticated: !!session,
    role,
    realRole,
    permissions,
    isImpersonating,
  }, "student"), children);
};

// ── ParentRoute ─────────────────────────────────────────────────────────────
// Only allows users with role=parent (or super_admin impersonating one).
export const ParentRoute = ({ children }: { children: ReactNode }) => {
  const { session, role, realRole, permissions, isImpersonating, loading, roleLoaded } = useAuth();
  if (loading || !roleLoaded) return <Spinner />;
  return renderDecision(decidePortalRoleAccess({
    isAuthenticated: !!session,
    role,
    realRole,
    permissions,
    isImpersonating,
  }, "parent"), children);
};

// ── ApplicantRoute ──────────────────────────────────────────────────────────
// For /my-applications: requires session, but redirects staff/students to main app.
export const ApplicantRoute = ({ children }: { children: ReactNode }) => {
  const { session, role, realRole, permissions, isImpersonating, loading, roleLoaded } = useAuth();
  if (loading || !roleLoaded) return <Spinner />;
  return renderDecision(decideApplicantAccess({
    isAuthenticated: !!session,
    role,
    realRole,
    permissions,
    isImpersonating,
  }), children);
};

// ── RequirePermission ───────────────────────────────────────────────────────
// Must be rendered inside <PermissionProvider>. Shows spinner while permissions
// load, then redirects to /forbidden if the user lacks the module:action grant.
// super_admin always passes.
export const RequirePermission = ({
  module,
  action,
  children,
}: {
  module: string;
  action: string;
  children: ReactNode;
}) => {
  const { permissions, loading } = usePermissions();
  const { session, role, realRole, isImpersonating } = useAuth();
  if (loading) return <InShellSpinner />;
  const accessState: AccessState = {
    isAuthenticated: !!session,
    role,
    realRole,
    permissions,
    isImpersonating,
  };
  return renderDecision(decidePermissionAccess(accessState, `${module}:${action}`), children);
};

// ── RequireRole ─────────────────────────────────────────────────────────────
// Redirects to /forbidden if the user's effective role is not in the allow-list.
// super_admin always passes.
export const RequireRole = ({
  roles,
  children,
}: {
  roles: string[];
  children: ReactNode;
}) => {
  const { session, role, realRole, permissions, isImpersonating } = useAuth();
  return renderDecision(decideRoleAccess({
    isAuthenticated: !!session,
    role,
    realRole,
    permissions,
    isImpersonating,
  }, roles), children);
};

// ── RedirectRole ────────────────────────────────────────────────────────────
// Not an access control — a consolidation. Some pages exist only to render a
// slice of data another page already shows; for the roles listed here we send
// the user to that one surface instead of keeping two ways to see the same rows.
// Everyone else gets the page unchanged.
export const RedirectRole = ({
  roles,
  to,
  children,
}: {
  roles: string[];
  to: string;
  children: ReactNode;
}) => {
  const { role, roleLoaded } = useAuth();
  if (!roleLoaded) return <Spinner />;
  if (role && roles.includes(role)) return <Navigate to={to} replace />;
  return <>{children}</>;
};

// ── BlockRole ───────────────────────────────────────────────────────────────
// Use when a broad permission is shared by a narrow portal role but a specific
// full-staff route must stay unavailable to that role.
export const BlockRole = ({
  roles,
  children,
}: {
  roles: string[];
  children: ReactNode;
}) => {
  const { session, role, realRole, permissions, isImpersonating } = useAuth();
  return renderDecision(decideBlockedRoleAccess({
    isAuthenticated: !!session,
    role,
    realRole,
    permissions,
    isImpersonating,
  }, roles), children);
};
