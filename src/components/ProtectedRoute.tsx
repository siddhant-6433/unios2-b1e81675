import { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { usePermissions } from "@/contexts/PermissionContext";

const NON_STAFF_ROLES = ["student", "parent"] as const;
const ACADEMIC_PARTNER_ALLOWED_PERMISSION = "academic_partner_portal:view";

const Spinner = () => (
  <div className="flex h-screen items-center justify-center bg-background">
    <div className="flex flex-col items-center gap-3">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      <p className="text-sm text-muted-foreground">Loading...</p>
    </div>
  </div>
);

// ── ProtectedRoute ──────────────────────────────────────────────────────────
// Legacy: kept for backward compat on routes that don't need role segmentation.
// Prefer StaffRoute for the main staff app catchall.
export const ProtectedRoute = ({ children }: { children: ReactNode }) => {
  const { session, role, realRole, loading, roleLoaded } = useAuth();
  if (loading || !roleLoaded) return <Spinner />;
  if (!session) return <Navigate to="/login" replace />;
  if (role === null && realRole !== "super_admin") return <Navigate to="/my-applications" replace />;
  return <>{children}</>;
};

// ── StaffRoute ──────────────────────────────────────────────────────────────
// For the main /* staff catchall. Blocks student/parent roles from entering
// the staff app and routes them to their own portals instead.
export const StaffRoute = ({ children }: { children: ReactNode }) => {
  const { session, role, realRole, loading, roleLoaded } = useAuth();
  const location = useLocation();
  if (loading || !roleLoaded) return <Spinner />;
  if (!session) return <Navigate to="/login" replace />;
  if (role === "student") return <Navigate to="/student" replace />;
  if (role === "parent") return <Navigate to="/parent" replace />;
  if (role === "academic_partner" && location.pathname !== "/academic-partner-portal") {
    return <Navigate to="/academic-partner-portal" replace />;
  }
  if (role === null && realRole !== "super_admin") return <Navigate to="/my-applications" replace />;
  return <>{children}</>;
};

// ── StudentRoute ────────────────────────────────────────────────────────────
// Only allows users with role=student (or super_admin impersonating one).
export const StudentRoute = ({ children }: { children: ReactNode }) => {
  const { session, role, realRole, loading, roleLoaded } = useAuth();
  if (loading || !roleLoaded) return <Spinner />;
  if (!session) return <Navigate to="/login" replace />;
  if (realRole === "super_admin") return <>{children}</>;
  if (role !== "student") return <Navigate to="/" replace />;
  return <>{children}</>;
};

// ── ParentRoute ─────────────────────────────────────────────────────────────
// Only allows users with role=parent (or super_admin impersonating one).
export const ParentRoute = ({ children }: { children: ReactNode }) => {
  const { session, role, realRole, loading, roleLoaded } = useAuth();
  if (loading || !roleLoaded) return <Spinner />;
  if (!session) return <Navigate to="/login" replace />;
  if (realRole === "super_admin") return <>{children}</>;
  if (role !== "parent") return <Navigate to="/" replace />;
  return <>{children}</>;
};

// ── ApplicantRoute ──────────────────────────────────────────────────────────
// For /my-applications: requires session, but redirects staff/students to main app.
export const ApplicantRoute = ({ children }: { children: ReactNode }) => {
  const { session, role, loading, roleLoaded } = useAuth();
  if (loading || !roleLoaded) return <Spinner />;
  if (!session) return <Navigate to="/login" replace />;
  if (role !== null) return <Navigate to="/" replace />;
  return <>{children}</>;
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
  const { role, realRole } = useAuth();
  if (loading) return <Spinner />;
  if (role === "academic_partner" && `${module}:${action}` !== ACADEMIC_PARTNER_ALLOWED_PERMISSION) {
    return <Navigate to="/academic-partner-portal" replace />;
  }
  if (realRole === "super_admin" || permissions.has(`${module}:${action}`)) return <>{children}</>;
  return <Navigate to="/forbidden" replace />;
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
  const { role, realRole } = useAuth();
  if (realRole === "super_admin") return <>{children}</>;
  if (role && roles.includes(role)) return <>{children}</>;
  return <Navigate to="/forbidden" replace />;
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
  const { role, realRole } = useAuth();
  if (realRole === "super_admin") return <>{children}</>;
  if (role && roles.includes(role)) return <Navigate to="/forbidden" replace />;
  return <>{children}</>;
};
