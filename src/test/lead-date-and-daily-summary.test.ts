import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const admissions = readFileSync("src/pages/Admissions.tsx", "utf8");
const publisherPortal = readFileSync("src/pages/PublisherPortal.tsx", "utf8");
const publisherAnalytics = readFileSync("src/pages/PublisherAnalytics.tsx", "utf8");
const dailySummaryFn = readFileSync("supabase/functions/daily-lead-summary-email/index.ts", "utf8");
const dailySummaryCron = readFileSync("supabase/migrations/20260627120100_daily_lead_summary_email_cron.sql", "utf8");
const supabaseConfig = readFileSync("supabase/config.toml", "utf8");

describe("lead date filters and daily lead summary", () => {
  it("uses shared quick date presets on lead, application-adjacent, and publisher lead filters", () => {
    expect(admissions).toContain("<DateRangeFilter");
    expect(admissions).toContain('ariaPrefix="Lead created"');
    expect(admissions).toContain('const [datePreset, setDatePreset] = useState<DatePreset>("all")');

    expect(publisherPortal).toContain("<DateRangeFilter");
    expect(publisherPortal).toContain('ariaPrefix="Publisher leads"');

    expect(publisherAnalytics).toContain("<DateRangeFilter");
    expect(publisherAnalytics).toContain('ariaPrefix="Publisher analytics"');
  });

  it("shows daily lead flow cards by source in publisher analytics", () => {
    expect(publisherAnalytics).toContain("Daily Lead Flow by Source");
    expect(publisherAnalytics).toContain('key: "today"');
    expect(publisherAnalytics).toContain('key: "yesterday"');
    expect(publisherAnalytics).toContain('key: "this_week"');
    expect(publisherAnalytics).toContain('key: "last_7"');
    expect(publisherAnalytics).toContain("sourceCounts");
  });

  it("does not stop publisher pagination at Supabase's 1000-row response cap", () => {
    expect(publisherPortal).not.toContain(".limit(PAGE + 1)");
    expect(publisherAnalytics).not.toContain(".limit(PAGE + 1)");
    expect(publisherPortal).toContain("fetched.length < PAGE");
    expect(publisherAnalytics).toContain("fetched.length < PAGE");
  });

  it("emails yesterday's leads with required table columns and a CSV attachment", () => {
    expect(dailySummaryFn).toContain('const subject = "Leads Added Yesterday"');
    expect(dailySummaryFn).toContain('select("id, name, phone, source, jd_category, created_at, courses:course_id(name)")');
    expect(dailySummaryFn).toContain('"Lead name"');
    expect(dailySummaryFn).toContain('"Mobile No"');
    expect(dailySummaryFn).toContain('"Course"');
    expect(dailySummaryFn).toContain('"JD Keyword"');
    expect(dailySummaryFn).toContain('"Source"');
    expect(dailySummaryFn).toContain("attachments: [{");
    expect(dailySummaryFn).toContain("LEAD_SUMMARY_EMAIL_TO");
  });

  it("schedules the daily summary at 12:01 AM IST and exposes the function", () => {
    expect(dailySummaryCron).toContain("'31 18 * * *'");
    expect(dailySummaryCron).toContain("/functions/v1/daily-lead-summary-email");
    expect(dailySummaryCron).toContain("'x-cron-secret'");
    expect(supabaseConfig).toContain("[functions.daily-lead-summary-email]");
    expect(supabaseConfig).toContain("verify_jwt = false");
  });
});
