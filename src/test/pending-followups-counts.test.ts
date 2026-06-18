import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pendingFollowupsPage = readFileSync("src/pages/PendingFollowups.tsx", "utf8");
const alignmentMigration = readFileSync(
  "supabase/migrations/20260620119500_align_action_badge_followup_counts.sql",
  "utf8",
);
const admissionsStatsMigration = readFileSync(
  "supabase/migrations/20260620120000_align_admissions_followup_stats.sql",
  "utf8",
);
const remainingSurfacesMigration = readFileSync(
  "supabase/migrations/20260620121000_align_remaining_followup_surfaces.sql",
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

  it("makes Admissions CRM alert counts use the same follow-up buckets", () => {
    expect(admissionsStatsMigration).toContain("ALTER FUNCTION public.admissions_stats(uuid, uuid)");
    expect(admissionsStatsMigration).toContain("CREATE OR REPLACE FUNCTION public.admissions_followup_bucket_counts");
    expect(admissionsStatsMigration).toContain(
      "COUNT(*) FILTER (WHERE lf.scheduled_at < b.today_start)::integer AS overdue",
    );
    expect(admissionsStatsMigration).toContain(
      "COUNT(*) FILTER (WHERE lf.scheduled_at >= b.today_start AND lf.scheduled_at <= b.current_time)::integer AS today",
    );
    expect(admissionsStatsMigration).toContain(
      "COUNT(*) FILTER (WHERE lf.scheduled_at > b.current_time AND lf.scheduled_at <= b.week_end)::integer AS upcoming",
    );
    expect(admissionsStatsMigration).toContain("'{overdue_followups}'");
    expect(admissionsStatsMigration).toContain("'{today_followups}'");
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
