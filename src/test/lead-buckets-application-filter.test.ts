import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync("supabase/migrations/20260619130000_unassigned_bucket_application_filter.sql", "utf8");
const leadBuckets = readFileSync("src/pages/LeadBuckets.tsx", "utf8");

describe("lead bucket application filter", () => {
  it("adds a database flag for leads with paid or submitted applications", () => {
    expect(migration).toContain("has_paid_or_submitted_application boolean");
    expect(migration).toContain("FROM public.applications a");
    expect(migration).toContain("a.lead_id = l.id");
    expect(migration).toContain("a.payment_status = 'paid'");
    expect(migration).toContain("a.submitted_at IS NOT NULL");
    expect(migration).toContain("NOT IN ('draft', 'in_progress')");
  });

  it("keeps facet counts scoped to the application filter", () => {
    expect(migration).toContain("_application_state text DEFAULT NULL");
    expect(migration).toContain("_application_state = 'none_paid_or_submitted'");
    expect(migration).toContain("has_paid_or_submitted_application = false");
    expect(migration).toContain("_application_state = 'has_paid_or_submitted'");
    expect(migration).toContain("has_paid_or_submitted_application = true");
  });

  it("exposes the application filter in Lead Buckets server-side scope and saved snapshots", () => {
    expect(leadBuckets).toContain('type ApplicationFilter = "all" | "none_paid_or_submitted" | "has_paid_or_submitted"');
    expect(leadBuckets).toContain("setApplicationFilter");
    expect(leadBuckets).toContain('q.eq("has_paid_or_submitted_application", false)');
    expect(leadBuckets).toContain('q.eq("has_paid_or_submitted_application", true)');
    expect(leadBuckets).toContain("No paid/submitted application");
    expect(leadBuckets).toContain("_application_state: applicationFilter");
    expect(leadBuckets).toContain("application_filter: applicationFilter");
  });
});
