import { describe, expect, it } from "vitest";
import { dedupeNewFeeHeads } from "../../supabase/functions/_shared/dedupe-application-fee-heads";
import { readMigration } from "./readMigration";

const migration = readMigration("dedupe_application_fee_ledger_heads");
const claimMigration = readMigration("serialize_application_fee_head_claims");

describe("application fee head provisioning", () => {
  it("keeps only one matching application fee item from a batch", () => {
    const items = [
      { fee_code_id: "form", fee_code_code: "FORM-FEE", fee_code_name: "Application Fee", term: "registration", id: "first" },
      { fee_code_id: "form", fee_code_code: "FORM-FEE", fee_code_name: "Application Fee", term: "registration", id: "duplicate" },
      { fee_code_id: "tuition", fee_code_code: "TUITION", fee_code_name: "Tuition", term: "year_1", id: "tuition" },
    ];

    expect(dedupeNewFeeHeads(items, new Set()).map((item) => item.id)).toEqual(["first", "tuition"]);
  });

  it("skips application fee heads already present while preserving unrelated rows", () => {
    const items = [
      { fee_code_id: "form", fee_code_code: "FORM-FEE", term: "registration", id: "existing-app-fee" },
      { fee_code_id: "lab", fee_code_code: "LAB", term: "registration", id: "lab-a" },
      { fee_code_id: "lab", fee_code_code: "LAB", term: "registration", id: "lab-b" },
    ];

    expect(dedupeNewFeeHeads(items, new Set(["form::registration"])).map((item) => item.id))
      .toEqual(["lab-a", "lab-b"]);
  });

  it("serializes database inserts and skips duplicate registration heads", () => {
    expect(migration).toContain("pg_advisory_xact_lock");
    expect(migration).toContain("trg_skip_duplicate_application_fee_head");
    expect(migration).toContain("RETURN NULL;");
    expect(claimMigration).toContain("PRIMARY KEY (student_id, fee_code_id, term)");
    expect(claimMigration).toContain("ON CONFLICT (student_id, fee_code_id, term) DO NOTHING");
    expect(claimMigration).toContain("DEFERRABLE INITIALLY DEFERRED");
  });

  it("moves receipt links, records amount differences, and rebuilds paid from confirmed payments", () => {
    expect(migration).toContain("UPDATE public.fee_ledger_payments");
    expect(migration).toContain("SET fee_ledger_id = v_canonical");
    expect(migration).toContain("fee_ledger_duplicate_repairs");
    expect(migration).toContain("v_before_paid - v_linked_confirmed");
    expect(migration).toMatch(/paid_amount\s*=\s*v_linked_confirmed/);
  });
});
