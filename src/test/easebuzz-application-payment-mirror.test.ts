import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const mirrorMigration = readFileSync(
  "supabase/migrations/20260619111000_easebuzz_mirrored_app_payment_gateway.sql",
  "utf8",
);

describe("Easebuzz application payment mirror", () => {
  it("stamps mirrored application-fee rows with the Easebuzz gateway", () => {
    expect(mirrorMigration).toContain("gateway, transaction_ref");
    expect(mirrorMigration).toContain("'easebuzz'");
    expect(mirrorMigration).toContain("notes LIKE 'Auto-mirrored from application %'");
  });

  it("does not let secondary lead_payments mirroring roll back paid applications", () => {
    expect(mirrorMigration).toContain("EXCEPTION WHEN OTHERS THEN");
    expect(mirrorMigration).toContain("RAISE WARNING '[mirror-app-payment] skipped");
    expect(mirrorMigration).toMatch(/RETURN NEW;\s*END;\s*\$\$/s);
  });
});
