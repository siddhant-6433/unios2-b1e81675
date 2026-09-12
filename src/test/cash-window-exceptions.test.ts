import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20260912140834_cash_window_exceptions.sql",
  "utf8",
);

describe("cash window exceptions", () => {
  it("stores campus-specific after-hours grants on an IST date", () => {
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.cash_window_exceptions");
    expect(migration).toContain("campus_id     uuid REFERENCES public.campuses(id)");
    expect(migration).toContain("allowed_date  date NOT NULL");
    expect(migration).toContain("cash_window_exceptions_campus_date_uq");
  });

  it("lets only a super_admin grant or revoke per campus", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.allow_after_hours_cash");
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.revoke_after_hours_cash");
    expect(migration).toContain("Only a super_admin can allow after-hours cash");
    expect(migration).toContain("Only a super_admin can revoke after-hours cash");
    expect(migration).toContain("After-hours cash can only be granted up to 30 days ahead");
    expect(migration).toContain("Turn the date off everywhere, including per-campus grants.");
    expect(migration).not.toContain("Only an accountant or super_admin can allow after-hours cash");
  });

  it("waives the 9 AM–6 PM clock without lifting a closed day", () => {
    expect(migration).toContain("CREATE OR REPLACE FUNCTION public.can_create_cash_receipt");
    expect(migration).toContain("FROM public.cash_window_exceptions e");
    expect(migration).toContain("Cash receipts can only be recorded between 9 AM and 6 PM.");
    expect(migration).toContain("FROM public.day_closures dc");
    expect(migration).toContain("The day has been closed for this campus. Cash receipts reopen at 9 AM tomorrow.");
    expect(migration.indexOf("cash_window_exceptions e")).toBeLessThan(
      migration.indexOf("day_closures dc"),
    );
  });
});
