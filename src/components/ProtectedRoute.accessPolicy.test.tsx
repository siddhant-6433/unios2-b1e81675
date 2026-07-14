import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RequirePermission, StaffRoute } from "@/components/ProtectedRoute";
import type { AppRole } from "@/lib/accessPolicy";

const mocks = vi.hoisted(() => ({
  auth: {
    session: { user: { id: "u1" } },
    role: "counsellor" as AppRole | null,
    realRole: "counsellor" as AppRole | null,
    permissions: ["leads:view"] as string[],
    isImpersonating: false,
    loading: false,
    roleLoaded: true,
  },
  permission: {
    permissions: new Set<string>(["leads:view"]),
    loading: false,
  },
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => mocks.auth,
}));

vi.mock("@/contexts/PermissionContext", () => ({
  usePermissions: () => mocks.permission,
}));

function renderAt(path: string, element: ReactNode) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={path} element={element} />
        <Route path="/academic-partner-portal" element={<div>Academic partner portal</div>} />
        <Route path="/forbidden" element={<div>Forbidden</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

describe("ProtectedRoute access policy wiring", () => {
  beforeEach(() => {
    mocks.auth.session = { user: { id: "u1" } };
    mocks.auth.role = "counsellor";
    mocks.auth.realRole = "counsellor";
    mocks.auth.permissions = ["leads:view"];
    mocks.auth.isImpersonating = false;
    mocks.auth.loading = false;
    mocks.auth.roleLoaded = true;
    mocks.permission.permissions = new Set(["leads:view"]);
    mocks.permission.loading = false;
  });

  it("redirects an academic partner away from staff routes through StaffRoute", async () => {
    mocks.auth.role = "academic_partner";
    mocks.auth.realRole = "academic_partner";
    mocks.auth.permissions = ["academic_partner_portal:view"];

    renderAt("/marketing", <StaffRoute><div>Marketing</div></StaffRoute>);

    expect(await screen.findByText("Academic partner portal")).toBeInTheDocument();
    expect(screen.queryByText("Marketing")).not.toBeInTheDocument();
  });

  it("keeps an offer-letter academic partner in the partner portal", async () => {
    mocks.auth.role = "academic_partner_offer_letter";
    mocks.auth.realRole = "academic_partner_offer_letter";
    mocks.auth.permissions = ["academic_partner_portal:view", "academic_partner_offer_letters:issue"];
    mocks.permission.permissions = new Set(["academic_partner_portal:view", "academic_partner_offer_letters:issue"]);

    renderAt("/applications", <StaffRoute><div>Applications</div></StaffRoute>);

    expect(await screen.findByText("Academic partner portal")).toBeInTheDocument();
    expect(screen.queryByText("Applications")).not.toBeInTheDocument();
  });

  it("allows an offer-letter academic partner to use the issue-offer permission", () => {
    mocks.auth.role = "academic_partner_offer_letter";
    mocks.auth.realRole = "academic_partner_offer_letter";
    mocks.auth.permissions = ["academic_partner_portal:view", "academic_partner_offer_letters:issue"];
    mocks.permission.permissions = new Set(["academic_partner_portal:view", "academic_partner_offer_letters:issue"]);

    renderAt(
      "/academic-partner-portal",
      <RequirePermission module="academic_partner_offer_letters" action="issue">
        <div>Issue offer</div>
      </RequirePermission>,
    );

    expect(screen.getByText("Issue offer")).toBeInTheDocument();
  });

  it("allows an admission head through RequirePermission when the effective permission is present", () => {
    mocks.auth.role = "admission_head";
    mocks.auth.realRole = "admission_head";
    mocks.auth.permissions = ["lead_allocation:view"];
    mocks.permission.permissions = new Set(["lead_allocation:view"]);

    renderAt(
      "/lead-allocation",
      <RequirePermission module="lead_allocation" action="view">
        <div>Lead allocation</div>
      </RequirePermission>,
    );

    expect(screen.getByText("Lead allocation")).toBeInTheDocument();
  });

  it("does not let a real super admin bypass permissions while impersonating a counsellor", async () => {
    mocks.auth.role = "counsellor";
    mocks.auth.realRole = "super_admin";
    mocks.auth.permissions = ["leads:view"];
    mocks.auth.isImpersonating = true;
    mocks.permission.permissions = new Set(["leads:view"]);

    renderAt(
      "/admin",
      <RequirePermission module="user_management" action="view">
        <div>Admin panel</div>
      </RequirePermission>,
    );

    expect(await screen.findByText("Forbidden")).toBeInTheDocument();
    expect(screen.queryByText("Admin panel")).not.toBeInTheDocument();
  });
});
