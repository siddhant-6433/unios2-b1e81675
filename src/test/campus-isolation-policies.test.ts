import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

const readMigration = (suffix: string) => {
  const dir = join(process.cwd(), "supabase/migrations");
  const file = readdirSync(dir).find((f) => f.endsWith(`_${suffix}.sql`));
  if (!file) throw new Error(`No migration found ending in _${suffix}.sql`);
  return readFileSync(join(dir, file), "utf8");
};

describe("Campus Data Isolation Migration Policies", () => {
  const migration = readMigration("campus_data_isolation");

  it("redefines public.user_assigned_campus_ids with string_to_array and unnest support", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.user_assigned_campus_ids");
    expect(migration).toContain("string_to_array(p.campus, ',')");
    expect(migration).toContain("unnest");
  });

  it("applies campus-isolation policies on public.students for SELECT, INSERT and UPDATE", () => {
    expect(migration).toContain('"Staff can view students"');
    expect(migration).toContain('"Staff can insert students"');
    expect(migration).toContain('"Staff can update students"');
    expect(migration).toContain("public.user_can_access_assigned_campus(auth.uid(), campus_id)");
    expect(migration).toContain("public.user_can_access_assigned_campus(auth.uid(), students.campus_id)");
  });

  it("applies campus-isolation policies on public.fee_ledger for SELECT, INSERT and UPDATE", () => {
    expect(migration).toContain('"Finance staff can view all ledger"');
    expect(migration).toContain('"Finance staff can insert ledger"');
    expect(migration).toContain('"Finance staff can update ledger"');
    expect(migration).toContain("public.user_can_access_assigned_campus(auth.uid(), s.campus_id)");
  });

  it("applies campus-isolation policies on public.payments for SELECT and INSERT", () => {
    expect(migration).toContain('"Finance staff can view payments"');
    expect(migration).toContain('"Finance staff can insert payments"');
    expect(migration).toContain("public.user_can_access_assigned_campus(auth.uid(), s.campus_id)");
  });

  it("applies campus-isolation policies on public.fee_ledger_payments for SELECT and INSERT", () => {
    expect(migration).toContain('"Finance staff can view ledger payments"');
    expect(migration).toContain('"Finance staff can insert ledger payments"');
  });

  it("applies campus-isolation policies on public.lead_payments for SELECT and INSERT", () => {
    expect(migration).toContain('"Staff can read lead_payments"');
    expect(migration).toContain('"Staff can insert lead_payments"');
    expect(migration).toContain("public.user_can_access_assigned_campus(auth.uid(), l.campus_id)");
  });

  it("applies campus-isolation policies on public.concessions for SELECT, INSERT and UPDATE", () => {
    expect(migration).toContain('"concessions_select"');
    expect(migration).toContain('"concessions_insert"');
    expect(migration).toContain('"concessions_update"');
  });

  it("applies campus-isolation policies on public.offer_waivers for SELECT", () => {
    expect(migration).toContain('"Staff can view offer waivers"');
    expect(migration).toContain("public.user_can_access_assigned_campus(auth.uid(), ol.campus_id)");
  });

  it("applies campus-isolation policies on public.leads for SELECT, INSERT and UPDATE", () => {
    expect(migration).toContain('"Staff can view leads"');
    expect(migration).toContain('"Staff can insert leads"');
    expect(migration).toContain('"Staff can update leads"');
    expect(migration).toContain("public.user_can_access_assigned_campus((SELECT auth.uid()), campus_id)");
  });

  it("applies campus-isolation policies on public.offer_letters for SELECT, INSERT and UPDATE", () => {
    expect(migration).toContain('"Staff can select offers"');
    expect(migration).toContain('"Staff can insert offers"');
    expect(migration).toContain('"Staff can update offers"');
    expect(migration).toContain("public.user_can_access_assigned_campus(auth.uid(), campus_id)");
  });

  it("applies campus-isolation policies on attendance, exam records and visits", () => {
    expect(migration).toContain('"Staff can manage attendance"');
    expect(migration).toContain('"Staff can manage exam records"');
    expect(migration).toContain('"Staff can manage visits"');
  });

  it("applies campus-isolation policies on lead followups, notes, and applications", () => {
    expect(migration).toContain('"Staff can manage lead notes"');
    expect(migration).toContain('"Staff can manage followups"');
    expect(migration).toContain('"Staff view all applications"');
    expect(migration).toContain('"Staff update applications"');
  });
});
