import { describe, expect, it } from "vitest";
import { readMigration } from "./readMigration";

const migration = readMigration("restrict_cron_hours_ist");
const loadRelief = readMigration("reduce_small_compute_load");

describe("IST cron day/night split", () => {
  it("keeps payment and WhatsApp delivery crons 24/7", () => {
    expect(loadRelief).toContain("'process-whatsapp-status-queue'");
    expect(loadRelief).toContain("'* * * * *'");
    expect(loadRelief).toContain("'whatsapp-buffer-worker'");
    expect(loadRelief).toContain("'easebuzz-lead-payment-reconcile-fast'");
    expect(migration).not.toMatch(/\('process-whatsapp-status-queue'/);
    expect(migration).not.toMatch(/\('whatsapp-buffer-worker'/);
    expect(migration).not.toMatch(/\('meta-leads-poll'/);
    expect(migration).not.toMatch(/\('payment-link-reconcile'/);
    expect(migration).not.toMatch(/\('cleanup-pgnet-http-response'/);
  });

  it("restricts calling-hour queues to 3-12 UTC (≈ 9am–6pm IST)", () => {
    expect(migration).toContain("'* 3-12 * * *'");
    expect(migration).toContain("('process-ai-call-queue'");
    expect(migration).toContain("('reconcile-stale-live-calls'");
    expect(migration).toContain("'*/2 3-12 * * *'");
    expect(migration).toContain("('marketing-campaign-dispatcher'");
    expect(migration).toContain("('process-wa-classification-queue'");
    expect(migration).toContain("('email-ai-reply'");
  });

  it("moves miner, Zoho, photos, and reports to 13-23,0-3 UTC (≈ 6pm–9am IST)", () => {
    expect(migration).toContain("('counsellor-call-miner'");
    expect(migration).toContain("'*/2 13-23,0-3 * * *'");
    expect(migration).toContain("('zoho-books-poll'");
    expect(migration).toContain("'*/15 13-23,0-3 * * *'");
    expect(migration).toContain("('process-student-photo-jobs'");
    expect(migration).toContain("('receipt-pdf-backfill'");
    expect(migration).toContain("('whatsapp-templates-sync'");
  });

  it("reschedules in place so edge-function secrets are not copied into git", () => {
    expect(migration).toContain("cron.alter_job");
    expect(migration).not.toContain("825230a9abd38418482572ca5ec24dbd06221ffa");
    expect(migration).toContain("vault.decrypted_secrets");
    expect(migration).toContain("library_set_enrich_cron");
    expect(migration).toContain("'*/30 13-23,0-3 * * *'");
  });
});
