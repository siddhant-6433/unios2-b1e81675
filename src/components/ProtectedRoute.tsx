import { ReactNode } from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";

const Spinner = () => (
  <div className="flex h-screen items-center justify-center bg-background">
    <div className="flex flex-col items-center gap-3">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
      <p className="text-sm text-muted-foreground">Loading...</p>
    </div>
  </div>
);

// ── ProtectedRoute ─────────────────────────────────────────────────────────
// Requires an active session AND a staff role.
// Applicants (session exists but no role) are redirected to /my-applications.
// When a super_admin is impersonating, always allow access (realRole check).
export const ProtectedRoute = ({ children }: { children: ReactNode }) => {
  const { session, role, realRole, loading, roleLoaded } = useAuth();

  if (loading || !roleLoaded) return <Spinner />;
  if (!session) return <Navigate to="/login" replace />;
  // If the real user is super_admin (impersonating), don't redirect
  if (role === null && realRole !== "super_admin") return <Navigate to="/my-applications" replace />;

  return <>{children}</>;
};

// ── ApplicantRoute ─────────────────────────────────────────────────────────
// For /my-applications: requires a session, but redirects staff to the main app.
export const ApplicantRoute = ({ children }: { children: ReactNode }) => {
  const { session, role, loading, roleLoaded } = useAuth();

  if (loading || !roleLoaded) return <Spinner />;
  if (!session) return <Navigate to="/login" replace />;
  if (role !== null) return <Navigate to="/" replace />;

  return <>{children}</>;
};
