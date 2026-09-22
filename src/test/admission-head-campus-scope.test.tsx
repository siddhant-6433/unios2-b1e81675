import { render, screen, waitFor } from "@testing-library/react";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { CampusProvider, useCampus } from "@/contexts/CampusContext";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  auth: { role: "admission_head" as string | null, profile: { campus: null as string | null } },
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: mocks.from },
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => mocks.auth,
}));

interface SupabaseChain {
  select: () => SupabaseChain;
  order: () => SupabaseChain;
  then: (resolve: (value: unknown) => void) => void;
}

function makeChain(selectPayload: unknown): SupabaseChain {
  const chain: SupabaseChain = {
    select: () => chain,
    order: () => chain,
    then: (resolve) => resolve(selectPayload),
  };
  return chain;
}

const CAMPUSES = [
  { id: "c1", name: "Greater Noida", code: "GN" },
  { id: "c2", name: "Ghaziabad", code: "GZB" },
];

const NO_ASSIGNED_CAMPUS_ID = "00000000-0000-0000-0000-000000000000";

function Probe() {
  const { selectedCampusId, selectedCampusName, canSelectAllCampuses } = useCampus();
  return (
    <div>
      <span data-testid="id">{selectedCampusId}</span>
      <span data-testid="name">{selectedCampusName}</span>
      <span data-testid="all">{String(canSelectAllCampuses)}</span>
    </div>
  );
}

const renderProvider = () =>
  render(
    <CampusProvider>
      <Probe />
    </CampusProvider>
  );

beforeEach(() => {
  mocks.from.mockReset();
  mocks.from.mockImplementation(() => makeChain({ data: CAMPUSES, error: null }));
});

describe("CampusContext admission head campus scope", () => {
  it("keeps an admission head org-wide when no campus is assigned", async () => {
    mocks.auth.role = "admission_head";
    mocks.auth.profile = { campus: null };

    renderProvider();

    // Regression: the "No assigned campus" sentinel must never become the
    // selected campus id for an admission head — callers treat any non-"all"
    // value as a real campus filter, which blanked the CRM.
    await waitFor(() => expect(screen.getByTestId("id").textContent).toBe("all"));
    expect(screen.getByTestId("name").textContent).toBe("All Campuses");
    expect(screen.getByTestId("all").textContent).toBe("true");
    expect(screen.getByTestId("id").textContent).not.toBe(NO_ASSIGNED_CAMPUS_ID);
  });

  it("keeps an admission head org-wide even when a campus is assigned", async () => {
    mocks.auth.role = "admission_head";
    mocks.auth.profile = { campus: "Ghaziabad" };

    renderProvider();

    await waitFor(() => expect(screen.getByTestId("id").textContent).toBe("all"));
    expect(screen.getByTestId("all").textContent).toBe("true");
  });

  it("still fails closed for a genuinely campus-scoped role with no assignment", async () => {
    mocks.auth.role = "campus_admin";
    mocks.auth.profile = { campus: null };

    renderProvider();

    await waitFor(() => expect(screen.getByTestId("id").textContent).toBe(NO_ASSIGNED_CAMPUS_ID));
    expect(screen.getByTestId("name").textContent).toBe("No assigned campus");
    expect(screen.getByTestId("all").textContent).toBe("false");
  });

  it("still scopes a campus-scoped role to its matched campus", async () => {
    mocks.auth.role = "campus_admin";
    mocks.auth.profile = { campus: "Ghaziabad" };

    renderProvider();

    await waitFor(() => expect(screen.getByTestId("id").textContent).toBe("c2"));
    expect(screen.getByTestId("name").textContent).toBe("Ghaziabad");
    expect(screen.getByTestId("all").textContent).toBe("false");
  });
});

describe("admission head org-wide campus scope migration", () => {
  const migrationDir = join(process.cwd(), "supabase/migrations");
  const file = readdirSync(migrationDir).find((f) =>
    f.endsWith("_admission_head_org_wide_campus_scope.sql")
  );
  const migration = file ? readFileSync(join(migrationDir, file), "utf8") : "";

  it("exists", () => {
    expect(file).toBeTruthy();
  });

  it("grants admission_head org-wide select on leads without a campus check", () => {
    expect(migration).toContain('CREATE POLICY "Admission head can view all leads" ON public.leads');

    const block = migration.slice(
      migration.indexOf('CREATE POLICY "Admission head can view all leads" ON public.leads'),
      migration.indexOf('CREATE POLICY "Admission head can insert leads" ON public.leads')
    );
    expect(block).toContain("FOR SELECT TO authenticated");
    expect(block).toContain("public.has_role(auth.uid(), 'admission_head'::app_role)");
    expect(block).not.toContain("user_can_access_assigned_campus");
  });

  it("grants admission_head org-wide access on the visit and followup tables", () => {
    expect(migration).toContain('CREATE POLICY "Admission head can manage all visits" ON public.campus_visits');
    expect(migration).toContain('CREATE POLICY "Admission head can manage all followups" ON public.lead_followups');
    expect(migration).toContain('CREATE POLICY "Admission head can manage all lead notes" ON public.lead_notes');
  });
});
