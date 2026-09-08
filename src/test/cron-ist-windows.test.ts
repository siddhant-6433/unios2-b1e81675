import { readFileSync } from "node:fs";
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

  it("installs process-wa-classification-queue on the day window", () => {
    const install = readMigration("install_wa_classification_queue_cron");
    expect(install).toContain("'process-wa-classification-queue'");
    expect(install).toContain("'* 3-12 * * *'");
    expect(install).toContain("SELECT public.fn_process_wa_classification_queue()");
    expect(install).toContain("created_at <= now() - interval '90 seconds'");
    expect(install).not.toMatch(/Bearer [A-Za-z0-9._-]{20,}/);
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

describe("nightly counsellor-score-cron grants", () => {
  it("lets service_role write penalty logs the 10pm IST cron actually uses", () => {
    // GRANT TO authenticated does not include service_role. The cron client
    // is service_role, which produced ~100 "permission denied for table
    // score_penalty_log / counsellor_score_events" at 10pm IST on 2026-09-08.
    const grants = readMigration("score_cron_service_role_grants");
    expect(grants).toContain("GRANT SELECT, INSERT, UPDATE, DELETE ON public.score_penalty_log TO service_role");
    expect(grants).toContain("GRANT SELECT, INSERT, UPDATE, DELETE ON public.counsellor_score_events TO service_role");
    expect(grants).toContain("GRANT SELECT ON public.post_visit_pending_followups TO service_role");
    expect(grants).toContain("GRANT SELECT ON public.overdue_followups TO service_role");
  });
});

describe("WhatsApp status-queue drain", () => {
  it("returns immediately when the queue is empty and uses an 80-row minute batch", () => {
    const statusBatch = readMigration("whatsapp_status_batch_empty_guard");
    expect(statusBatch).toContain("SELECT 1 FROM public.whatsapp_status_queue WHERE processed_at IS NULL LIMIT 1");
    expect(statusBatch).toContain("DEFAULT 80");
    expect(statusBatch).toContain("process_whatsapp_status_batch(80)");
    expect(statusBatch).not.toMatch(/Bearer [A-Za-z0-9._-]{20,}/);
  });
});

describe("automation engine concurrency probe", () => {
  it("does not COUNT(*) automation_rule_executions on every invoke", () => {
    const engine = readFileSync("supabase/functions/automation-engine/index.ts", "utf8");
    expect(engine).toContain('.select("id")');
    expect(engine).toContain(".limit(MAX_CONCURRENT)");
    expect(engine).not.toContain('count: "exact"');
  });
});
