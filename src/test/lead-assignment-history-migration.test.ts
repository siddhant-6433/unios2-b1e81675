import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const initialMigration = readFileSync(
  "supabase/migrations/20260619090000_lead_assignment_history.sql",
  "utf8",
);
const backfillMigration = readFileSync(
  "supabase/migrations/20260619091000_backfill_lead_assignment_history.sql",
  "utf8",
);
const filterMigration = readFileSync(
  "supabase/migrations/20260619093000_filter_lead_assignment_history_by_assigner.sql",
  "utf8",
);
const dedupeMigration = readFileSync(
  "supabase/migrations/20260619094000_dedupe_lead_assignment_history_backfill.sql",
  "utf8",
);

describe("lead assignment history migrations", () => {
  it("creates a scoped audit table for admins, counsellors, and team leaders", () => {
    expect(initialMigration).toContain("CREATE TABLE IF NOT EXISTS public.lead_assignment_history");
    expect(initialMigration).toContain("ALTER TABLE public.lead_assignment_history ENABLE ROW LEVEL SECURITY");
    expect(initialMigration).toContain("Admins can view lead assignment history");
    expect(initialMigration).toContain("Counsellors can view own lead assignment history");
    expect(initialMigration).toContain("Team leaders can view team lead assignment history");
    expect(initialMigration).toContain("member.id = lead_assignment_history.assigned_to");
  });

  it("records self-picked and assigned events at the claim_leads choke point", () => {
    expect(initialMigration).toContain("CREATE OR REPLACE FUNCTION public.claim_leads");
    expect(initialMigration).toContain("INSERT INTO public.lead_assignment_history");
    expect(initialMigration).toContain("WHEN NOT v_is_admin");
    expect(initialMigration).toContain("THEN 'self_picked'");
    expect(initialMigration).toContain("ELSE 'assigned'");
    expect(initialMigration).toContain("get_unassigned_leads_bucket()");
  });

  it("backfills current assignments without duplicating lead/counsellor pairs", () => {
    expect(backfillMigration).toContain("WHERE l.counsellor_id IS NOT NULL");
    expect(backfillMigration).toContain("COALESCE(l.assigned_at, l.updated_at, l.created_at)");
    expect(backfillMigration).toContain("LEFT JOIN LATERAL");
    expect(backfillMigration).toContain("LIMIT 1");
    expect(backfillMigration).toContain("AND NOT EXISTS");
    expect(backfillMigration).toContain("h.lead_id = l.id");
    expect(backfillMigration).toContain("h.assigned_to = l.counsellor_id");
    expect(dedupeMigration).toContain("row_number() OVER");
    expect(dedupeMigration).toContain("r.row_num > 1");
  });

  it("exposes server-side filters including assigned-by and system imports", () => {
    expect(filterMigration).toContain("_assigned_by_profile_ids uuid[] DEFAULT NULL");
    expect(filterMigration).toContain("_include_system_assigned_by boolean DEFAULT false");
    expect(filterMigration).toContain("h.assigned_by_profile_id = ANY(_assigned_by_profile_ids)");
    expect(filterMigration).toContain("AND h.assigned_by_profile_id IS NULL");
    expect(filterMigration).toContain("h.assignment_source = ANY(_sources)");
    expect(filterMigration).toContain("latest.disposition::text = ANY(_call_dispositions)");
  });
});
