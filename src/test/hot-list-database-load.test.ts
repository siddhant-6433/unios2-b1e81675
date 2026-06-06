import { readdirSync, readFileSync } from "node:fs";
import { basename } from "node:path";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(path, "utf8");

const hotListFiles = [
  "src/pages/Admissions.tsx",
  "src/pages/AiCallLog.tsx",
  "src/pages/CallLog.tsx",
  "src/pages/LeadBuckets.tsx",
  "src/pages/PublisherAnalytics.tsx",
  "src/pages/PublisherPortal.tsx",
  "src/pages/WhatsAppInbox.tsx",
];

const keysetMigration = read("supabase/migrations/20260618202000_keyset_pagination_and_wa_view_indexes.sql");
const fkMigration = read("supabase/migrations/20260618203000_activity_ranked_fk_indexes.sql");
const hygieneMigration = read("supabase/migrations/20260618204000_db_hygiene_fk_and_duplicate_indexes.sql");

describe("hot list database load guardrails", () => {
  it("keeps hot list pages off offset/range pagination", () => {
    for (const file of hotListFiles) {
      expect(read(file), `${file} should use cursor pagination`).not.toContain(".range(");
    }
  });

  it("keeps exact counts out of hot dashboard and list paths", () => {
    const hotCountFiles = [
      ...hotListFiles,
      "src/components/admissions/CloudDialerNudge.tsx",
      "src/components/admissions/InactivityAlertBanner.tsx",
      "src/pages/CloudDialer.tsx",
      "src/pages/Dashboard.tsx",
      "src/pages/Finance.tsx",
      "src/pages/HrDashboard.tsx",
      "src/pages/Inbox.tsx",
    ];

    for (const file of hotCountFiles) {
      expect(read(file), `${file} should avoid count exact`).not.toContain('count: "exact"');
    }
  });

  it("keeps the overview dashboard on the single aggregate payload", () => {
    const dashboard = read("src/pages/Dashboard.tsx");
    const dashboardOverview = read("supabase/migrations/20260618211200_dashboard_overview_rpc.sql");

    expect(dashboard).toContain('rpc("dashboard_overview"');
    expect(read("src/components/dashboard/DashboardAnalytics.tsx")).toContain('rpc("dashboard_analytics"');
    expect(dashboard).not.toContain('rpc("get_lead_stage_counts"');
    expect(dashboard).not.toContain('from("fee_ledger")');
    expect(dashboard).not.toContain('from("students").select("status');
    expect(dashboard).not.toContain('from("leads").select("source")');
    expect(dashboard).not.toContain('from("leads").select("created_at")');
    expect(dashboard).not.toContain('from "recharts"');
    expect(read("src/components/dashboard/DashboardAnalytics.tsx")).toContain('from "recharts"');
    expect(dashboardOverview).toMatch(/\bSECURITY\s+INVOKER\b/i);
    expect(dashboardOverview).toContain("jsonb_build_object");
    expect(dashboardOverview).toContain("GRANT EXECUTE ON FUNCTION public.dashboard_overview(uuid) TO authenticated");
    expect(dashboardOverview).toContain("GRANT EXECUTE ON FUNCTION public.dashboard_analytics(uuid) TO authenticated");
  });

  it("ships the indexes and stats RPC that support cursor-based reads", () => {
    expect(keysetMigration).toContain("idx_leads_created_id_desc");
    expect(keysetMigration).toContain("idx_call_logs_created_id_desc");
    expect(keysetMigration).toContain("idx_ai_call_records_created_id_desc");
    expect(keysetMigration).toContain("idx_wa_messages_conversation_latest");
    expect(keysetMigration).toContain("CREATE OR REPLACE FUNCTION public.ai_call_log_stats");
    expect(keysetMigration).toMatch(/\bSECURITY\s+INVOKER\b/i);
  });

  it("indexes the activity-ranked foreign keys and removes exact duplicate indexes", () => {
    expect(fkMigration).toContain("idx_whatsapp_messages_read_by_fk");
    expect(fkMigration).toContain("idx_leads_course_id_fk");
    expect(fkMigration).toContain("idx_ai_call_records_initiated_by_fk");
    expect(hygieneMigration).toContain("idx_lead_payments_recorded_by_fk");
    expect(hygieneMigration).toContain("idx_offer_letters_lead_id_fk");
    expect(hygieneMigration).toContain("DROP INDEX IF EXISTS public.idx_call_logs_inbound_missed_lead");
    expect(hygieneMigration).toContain("DROP INDEX IF EXISTS public.idx_lead_activities_lead_created");
  });

  it("does not add new duplicate migration versions", () => {
    const versions = readdirSync("supabase/migrations")
      .filter((name) => name.endsWith(".sql"))
      .map((name) => basename(name).split("_")[0]);
    const duplicates = versions.filter((version, index) => versions.indexOf(version) !== index);

    expect(duplicates).toEqual([]);
  });
});
