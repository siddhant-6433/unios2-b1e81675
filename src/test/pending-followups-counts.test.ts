import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pendingFollowupsPage = readFileSync("src/pages/PendingFollowups.tsx", "utf8");
const admissionsPage = readFileSync("src/pages/Admissions.tsx", "utf8");
const admissionsDataHook = readFileSync("src/hooks/useAdmissionsData.ts", "utf8");
const alignmentMigration = readFileSync(
  "supabase/migrations/20260620119500_align_action_badge_followup_counts.sql",
  "utf8",
);
const remainingSurfacesMigration = readFileSync(
  "supabase/migrations/20260620121000_align_remaining_followup_surfaces.sql",
  "utf8",
);
const admissionsBannerMigration = readFileSync(
  "supabase/migrations/20260620125000_align_admissions_banner_with_pending_followups.sql",
  "utf8",
);

describe("pending follow-up count alignment", () => {
  it("keeps the page headline total aligned with every visible follow-up tab", () => {
    expect(pendingFollowupsPage).toContain(
      "counts.overdue + counts.today + counts.upcoming + counts.visit_confirm + counts.unclosed_visits + counts.post_visit",
    );
  });

  it("makes action badge follow-up buckets use the same due-window semantics as the page", () => {
    expect(alignmentMigration).toContain("CREATE OR REPLACE FUNCTION public.followup_badge_bucket_counts");
    expect(alignmentMigration).toContain("COUNT(*) FILTER (WHERE lf.scheduled_at < b.today_start)::integer AS overdue");
    expect(alignmentMigration).toContain(
      "COUNT(*) FILTER (WHERE lf.scheduled_at >= b.today_start AND lf.scheduled_at <= b.current_time)::integer AS today",
    );
    expect(alignmentMigration).toContain(
      "COUNT(*) FILTER (WHERE lf.scheduled_at > b.current_time AND lf.scheduled_at <= b.week_end)::integer AS upcoming",
    );
    expect(alignmentMigration).toContain("v_followups := public.followup_badge_bucket_counts");
    expect(alignmentMigration).toContain("v_payload := jsonb_set(COALESCE(v_payload, '{}'::jsonb), '{overdue}'");
    expect(alignmentMigration).toContain("v_payload := jsonb_set(v_payload, '{today}'");
  });

  it("does not use the legacy admissions_stats aggregate in frontend code", () => {
    expect(admissionsDataHook).not.toContain("admissions_stats");
    expect(admissionsDataHook).not.toContain("useAdmissionsStats");
    expect(admissionsPage).not.toContain("useAdmissionsStats");
    expect(admissionsPage).not.toContain("statsData");
  });

  it("keeps the Admissions counsellor banner backed by the Pending Follow-ups payload", () => {
    expect(admissionsBannerMigration).toContain("CREATE OR REPLACE FUNCTION public.admissions_followup_bucket_counts");
    expect(admissionsBannerMigration).toContain("v_role_name = 'counsellor' OR p_counsellor_id IS NOT NULL");
    expect(admissionsBannerMigration).toContain("v_page_payload := public.pending_followups_payload");
    expect(admissionsBannerMigration).toContain("v_page_counts := COALESCE(v_page_payload->'counts'");
    expect(admissionsBannerMigration).toContain("'overdue_followups', v_overdue");
    expect(admissionsBannerMigration).toContain("'today_followups', v_today");
  });

  it("keeps the Admissions banner fresh after Pending Follow-ups changes", () => {
    expect(admissionsDataHook).toContain("refetchInterval: 30_000");
    expect(admissionsDataHook).toContain('refetchOnMount: "always"');
    expect(pendingFollowupsPage).toContain("invalidateAdmissionsFollowupSurfaces");
    expect(pendingFollowupsPage).toContain('queryClient.invalidateQueries({ queryKey: ["admissions-followup-counts"] })');
    expect(pendingFollowupsPage).toContain('queryClient.invalidateQueries({ queryKey: ["admissions-overview"] })');
  });

  it("makes the Admissions counsellor alert use Pending Follow-ups counts directly", () => {
    expect(admissionsDataHook).toContain("export function useAdmissionsFollowupCounts");
    expect(admissionsDataHook).toContain('queryKey: ["admissions-followup-counts", counsellorId]');
    expect(admissionsDataHook).toContain('supabase.rpc("pending_followups_payload"');
    expect(admissionsDataHook).toContain("pending: overdue + today + upcoming");
    expect(admissionsPage).toContain("useAdmissionsFollowupCounts");
    expect(admissionsPage).toContain("dashboardFollowups?.today");
    expect(admissionsPage).toContain("dashboardFollowups?.overdue");
  });

  it("aligns dashboard cards and direct overdue view consumers", () => {
    expect(remainingSurfacesMigration).toContain("CREATE OR REPLACE VIEW public.overdue_followups");
    expect(remainingSurfacesMigration).toContain("lf.scheduled_at < date_trunc('day', now())");
    expect(remainingSurfacesMigration).toContain("CREATE OR REPLACE VIEW public.counsellor_tat_defaults");
    expect(remainingSurfacesMigration).toContain("CREATE OR REPLACE FUNCTION public.my_tat_defaults");
    expect(remainingSurfacesMigration).toContain("CREATE OR REPLACE FUNCTION public.action_center_payload");
    expect(remainingSurfacesMigration).toContain("CREATE OR REPLACE FUNCTION public.admissions_overview");
    expect(remainingSurfacesMigration).toContain("CREATE OR REPLACE FUNCTION public.counsellor_calling_summary");
    expect(remainingSurfacesMigration).toContain("CREATE OR REPLACE FUNCTION public.get_counsellor_performance_stats");
  });
});
