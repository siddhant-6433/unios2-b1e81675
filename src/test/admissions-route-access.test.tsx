import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ADMISSIONS_ROLES, type AppRole } from "@/lib/accessPolicy";
import { RequirePermission, RequireRole } from "@/components/ProtectedRoute";

const auth = vi.hoisted(() => ({
  session: {}, role: "accountant" as string, realRole: "accountant" as string,
  permissions: new Set<string>(), isImpersonating: false,
}));
vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => auth }));
vi.mock("@/contexts/PermissionContext", () => ({
  usePermissions: () => ({ permissions: auth.permissions, loading: false }),
}));
vi.mock("@/components/ui/thinking-orb", () => ({ OrbLoader: () => null }));
vi.mock("@/components/ui/page-loader", () => ({ PageLoader: () => null }));

afterEach(cleanup);

function open(path: string, role: AppRole, permissions = ["leads:view"], impersonating = false) {
  Object.assign(auth, {
    role, realRole: impersonating ? "super_admin" : role,
    permissions: new Set(permissions), isImpersonating: impersonating,
  });
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/admissions" element={
          <RequireRole roles={ADMISSIONS_ROLES}>
            <RequirePermission module="leads" action="view"><div>Leads listing</div></RequirePermission>
          </RequireRole>
        } />
        <Route path="/admissions/:id" element={
          <RequirePermission module="leads" action="view"><div>Lead details</div></RequirePermission>
        } />
        <Route path="/forbidden" element={<div>Access denied</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("Admissions route guards", () => {
  it.each(["accountant", "office_admin"] as const)("blocks the %s listing while preserving individual leads", (role) => {
    open("/admissions", role);
    expect(screen.getByText("Access denied")).toBeInTheDocument();
    cleanup();
    open("/admissions/lead-123", role);
    expect(screen.getByText("Lead details")).toBeInTheDocument();
  });

  it.each(ADMISSIONS_ROLES)("allows the %s listing with lead permission", (role) => {
    open("/admissions", role);
    expect(screen.getByText("Leads listing")).toBeInTheDocument();
  });

  it("still requires lead permission for admission heads", () => {
    open("/admissions", "admission_head", []);
    expect(screen.getByText("Access denied")).toBeInTheDocument();
  });

  it("still requires lead permission for individual leads", () => {
    open("/admissions/lead-123", "office_admin", []);
    expect(screen.getByText("Access denied")).toBeInTheDocument();
  });

  it("blocks a super admin impersonating an accountant from the listing", () => {
    open("/admissions", "accountant", ["leads:view"], true);
    expect(screen.getByText("Access denied")).toBeInTheDocument();
  });
});
