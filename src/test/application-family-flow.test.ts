import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("school family application foundation", () => {
  it("creates a parent family container while preserving one application row per child", () => {
    const migration = readFileSync("supabase/migrations/20260701153000_school_application_families.sql", "utf8");

    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.application_families");
    expect(migration).toContain("family_application_id text NOT NULL UNIQUE");
    expect(migration).toContain("total_application_fee numeric(12,2)");
    expect(migration).toContain("payment_status text NOT NULL DEFAULT 'pending'");
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS family_id uuid REFERENCES public.application_families");
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS child_sequence integer");
    expect(migration).toContain("idx_applications_family");
  });

  it("provides a grouped application-fee payment allocation function", () => {
    const migration = readFileSync("supabase/migrations/20260701153000_school_application_families.sql", "utf8");

    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.mark_application_family_paid");
    expect(migration).toContain("UPDATE public.application_families");
    expect(migration).toContain("payment_ref = COALESCE(_payment_ref, payment_ref)");
    expect(migration).toContain("UPDATE public.applications");
    expect(migration).toContain("payment_ref = COALESCE(_payment_ref, payment_ref)");
    expect(migration).toContain("WHERE family_id = _family_id");
    expect(migration).toContain("GRANT EXECUTE ON FUNCTION public.mark_application_family_paid");
  });
});
