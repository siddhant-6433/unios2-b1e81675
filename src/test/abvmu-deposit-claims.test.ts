import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  "supabase/migrations/20260713180000_abvmu_deposit_claims.sql",
  "utf8",
);
const tokenPanel = readFileSync("src/components/applicant/TokenFeePanel.tsx", "utf8");
const inbox = readFileSync("src/pages/Inbox.tsx", "utf8");

describe("ABVMU deposit challan claims", () => {
  it("creates claims table and fee provisional credit hooks", () => {
    expect(migration).toContain("CREATE TABLE IF NOT EXISTS public.abvmu_deposit_claims");
    expect(migration).toContain("status IN ('pending', 'approved', 'rejected', 'settled')");
    expect(migration).toContain("lead_abvmu_approved_credit");
    expect(migration).toContain("abvmu_approved_credit");
    expect(migration).toContain("submit_abvmu_deposit_claim");
    expect(migration).toContain("decide_abvmu_deposit_claim");
    expect(migration).toContain("settle_abvmu_deposit_claim");
    expect(migration).toContain("Only super admins can decide ABVMU deposit claims");
  });

  it("defers receipt until settle (approved is provisional only)", () => {
    expect(migration).toContain("receipt deferred until university remittance");
    expect(migration).toContain("type");
    expect(migration).toContain("'other'");
    expect(migration).toContain("settlement_payment_id");
  });

  it("wires applicant upload UI and super-admin inbox", () => {
    expect(tokenPanel).toContain("submit_abvmu_deposit_claim");
    expect(tokenPanel).toContain("Already paid ABVMU deposit");
    expect(tokenPanel).toContain("abvmu_deposit_amount");
    expect(inbox).toContain("abvmu_deposits");
    expect(inbox).toContain("decide_abvmu_deposit_claim");
    expect(inbox).toContain("ABVMU Deposits");
  });
});
