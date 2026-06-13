import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const mirrorMigration = readFileSync(
  "supabase/migrations/20260619111000_easebuzz_mirrored_app_payment_gateway.sql",
  "utf8",
);

describe("Gateway application payment mirror", () => {
  it("stamps mirrored application-fee rows with a gateway source", () => {
    expect(mirrorMigration).toContain("gateway, transaction_ref");
    expect(mirrorMigration).toContain("'easebuzz'");
    expect(mirrorMigration).toContain("'cashfree'");
    expect(mirrorMigration).toContain("'icici'");
    expect(mirrorMigration).toContain("'offline'");
    expect(mirrorMigration).toContain("'online'");
    expect(mirrorMigration).toContain("notes LIKE 'Auto-mirrored from application %'");
  });

  it("does not let secondary lead_payments mirroring roll back paid applications", () => {
    expect(mirrorMigration).toContain("EXCEPTION WHEN OTHERS THEN");
    expect(mirrorMigration).toContain("RAISE WARNING '[mirror-app-payment] skipped");
    expect(mirrorMigration).toMatch(/RETURN NEW;\s*END;\s*\$\$/s);
  });

  it("allows failed lead-payment attempts to be recorded for support", () => {
    expect(mirrorMigration).toContain("DROP CONSTRAINT IF EXISTS lead_payments_status_check");
    expect(mirrorMigration).toContain("'failed'");
  });

  it("keeps app-layer gateway rows out of DB notification side effects", () => {
    expect(mirrorMigration).toContain("fn_notify_app_fee_paid");
    expect(mirrorMigration).toContain("fn_notify_payment_received");
    expect(mirrorMigration).toContain("('offline','easebuzz','icici','cashfree','online')");
  });
});
