import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync("supabase/migrations/20260630123000_principal_registration_details.sql", "utf8");

function blockBetween(start: string, end: string): string {
  const startIndex = migration.indexOf(start);
  const endIndex = migration.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return migration.slice(startIndex, endIndex);
}

describe("principal registration access", () => {
  it("allows principals to save CAHET registration details and proof files", () => {
    const cahetBlock = blockBetween("-- ========== CAHET storage ==========", "-- ========== UPDELED storage ==========");

    expect(cahetBlock).toContain("CREATE POLICY \"Staff can upload cahet docs\"");
    expect(cahetBlock).toContain("CREATE POLICY \"Staff can view cahet docs\"");
    expect(cahetBlock).toContain("CREATE POLICY \"Staff can insert cahet registrations\"");
    expect(cahetBlock).toContain("CREATE POLICY \"Staff can update cahet registrations\"");
    expect(cahetBlock).toContain("CREATE OR REPLACE FUNCTION public.cahet_mark_registered");
    expect(cahetBlock).toContain("public.has_role(auth.uid(), 'principal')");
  });

  it("allows principals to save UPDELED registration details and proof files", () => {
    const updeledBlock = migration.slice(migration.indexOf("-- ========== UPDELED storage =========="));

    expect(updeledBlock).toContain("CREATE POLICY \"Staff can upload updeled docs\"");
    expect(updeledBlock).toContain("CREATE POLICY \"Staff can view updeled docs\"");
    expect(updeledBlock).toContain("CREATE POLICY \"Staff can insert updeled registrations\"");
    expect(updeledBlock).toContain("CREATE POLICY \"Staff can update updeled registrations\"");
    expect(updeledBlock).toContain("CREATE OR REPLACE FUNCTION public.updeled_mark_registered");
    expect(updeledBlock).toContain("public.has_role(auth.uid(), 'principal')");
  });
});
