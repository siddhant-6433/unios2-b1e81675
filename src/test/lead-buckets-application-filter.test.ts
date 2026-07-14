import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync("supabase/migrations/20260619130000_unassigned_bucket_application_filter.sql", "utf8");
const routingMigration = readFileSync("supabase/migrations/20260620113000_ai_call_interest_assignment_and_cold_bucket.sql", "utf8");
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

  it("adds created-date filters and reversible newest-first sorting to Lead Buckets", () => {
    expect(leadBuckets).toContain('const [fromDate, setFromDate] = useState("")');
    expect(leadBuckets).toContain('const [toDate, setToDate] = useState("")');
    expect(leadBuckets).toContain('const [sortOrder, setSortOrder] = useState<BucketSortOrder>("newest")');
    expect(leadBuckets).toContain('q.gte("created_at", `${fromDate}T00:00:00`)');
    expect(leadBuckets).toContain('q.lte("created_at", `${toDate}T23:59:59.999`)');
    expect(leadBuckets).toContain('sortOrder === "newest" ? "Newest first" : "Oldest first"');
    expect(leadBuckets).toContain("from_date: fromDate || null");
    expect(leadBuckets).toContain("to_date: toDate || null");
  });

  it("keeps cold unassigned leads in the pickup bucket", () => {
    expect(routingMigration).toContain("keep cold");
    expect(routingMigration).toContain("l.stage NOT IN ('admitted', 'rejected', 'not_interested', 'dnc', 'ineligible')");
    expect(routingMigration).not.toContain("l.stage NOT IN ('admitted', 'rejected', 'not_interested', 'dnc', 'ineligible', 'cold')");
  });
});
