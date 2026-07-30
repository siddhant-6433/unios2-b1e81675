import { readFileSync, readdirSync } from "node:fs";

const shared = readFileSync("supabase/functions/_shared/gateway-settlement.ts", "utf8");
const easebuzzPayment = readFileSync("supabase/functions/easebuzz-payment/index.ts", "utf8");
// Resolved by suffix — the pre-commit hook re-stamps migration timestamps.
const migrationFile = readdirSync("supabase/migrations").find((f) =>
  f.endsWith("_easebuzz_lead_payment_reconcile.sql"),
)!;
const migration = readFileSync(`supabase/migrations/${migrationFile}`, "utf8");

describe("Easebuzz lead-payment reconcile fallback", () => {
  // The original bug: gateway-settlement.ts emitted source='surl', the DB
  // CHECK didn't allow it, and claimGatewayPayment failed OPEN on the
  // violation — silently disabling the at-most-once ledger. Any new
  // SettlementSource added to the union must land in the CHECK too.
  it("every SettlementSource is allowed by the gateway_settlements CHECK", () => {
    const union = shared.match(/export type SettlementSource =([^;]+);/);
    expect(union).toBeTruthy();
    const sources = [...union![1].matchAll(/"([a-z_]+)"/g)].map((m) => m[1]);
    expect(sources).toContain("surl");
    expect(sources.length).toBeGreaterThan(4);

    const check = migration.match(/gateway_settlements_source_check\s*\n?\s*CHECK \(source = ANY \(ARRAY\[([^\]]+)\]/);
    expect(check).toBeTruthy();
    const allowed = [...check![1].matchAll(/'([a-z_]+)'/g)].map((m) => m[1]);

    for (const s of sources) expect(allowed).toContain(s);
  });

  it("initiate-lead-payment persists the LP txnid on the pending row", () => {
    // Without this the reconcile poller has no handle on the transaction.
    expect(easebuzzPayment).toContain("persist lead txnid failed");
    expect(easebuzzPayment).toMatch(
      /\.from\("lead_payments"\)\s*\n\s*\.update\(\{ transaction_ref: txnid \}\)/,
    );
  });

  it("reconcile-lead-payments is service-key gated and amount-checked", () => {
    expect(easebuzzPayment).toContain('action === "reconcile-lead-payments"');
    expect(easebuzzPayment).toMatch(/Authorization"\) \|\| ""\) !== `Bearer \$\{serviceKey\}`/);
    expect(easebuzzPayment).toContain('.like("transaction_ref", "LP%")');
    expect(easebuzzPayment).toContain('reason: "amount_mismatch"');
    expect(easebuzzPayment).toContain('reason: "settle_failed"');
    // Settles through the shared claim-once helper, never a bare update.
    expect(easebuzzPayment).toMatch(
      /settleLeadPaymentRow\(admin, row\.id, easepayid, \{[\s\S]{0,160}source: "reconcile"/,
    );
  });

  it("the reconcile cron is scheduled", () => {
    expect(migration).toContain("easebuzz-lead-payment-reconcile");
    expect(migration).toContain('"action":"reconcile-lead-payments"');
    expect(migration).toContain("cron.unschedule");
  });
});
