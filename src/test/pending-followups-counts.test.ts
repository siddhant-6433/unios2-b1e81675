import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const pendingFollowupsPage = readFileSync("src/pages/PendingFollowups.tsx", "utf8");
const alignmentMigration = readFileSync(
  "supabase/migrations/20260620119000_align_action_badge_followup_counts.sql",
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
});
