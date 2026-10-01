import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";

/**
 * Guardrails for the HR module finalization. These do not run SQL; they assert
 * that the migrations and wiring that close the audited gaps are present, so a
 * later edit cannot silently remove a cron job, a permission check, or the
 * column-level self-update guard.
 */

const migrationsDir = "supabase/migrations";
const read = (rel: string) => readFileSync(rel, "utf8");

// The pre-commit hook restamps newly-added migrations to the real commit time,
// so locate them by slug suffix rather than a fixed version.
const MIGRATIONS = {
  drift: "hr_schema_drift_locations",
  security: "hr_security_hardening",
  leave: "hr_leave_engine_completion",
  automation: "hr_attendance_automation_cron",
  expenses: "hr_expenses_reimbursements",
  performance: "hr_performance_management",
  engagement: "hr_engagement_helpdesk",
  reports: "hr_reports_rpc",
} as const;

const migrationFile = (slug: string) => {
  const files = readdirSync(migrationsDir).filter((f) => /^\d{14}_.*\.sql$/.test(f) && f.endsWith(`_${slug}.sql`));
  expect(files.length, `expected exactly one migration named *_${slug}.sql, found ${files.join(", ")}`).toBe(1);
  return `${migrationsDir}/${files[0]}`;
};

const migration = (key: keyof typeof MIGRATIONS) => {
  const path = migrationFile(MIGRATIONS[key]);
  expect(existsSync(path), `${path} should exist`).toBe(true);
  return readFileSync(path, "utf8");
};

describe("HR schema drift restoration", () => {
  const sql = migration("drift");
  it("recreates hr_locations and business_units idempotently", () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.hr_locations/);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.business_units/);
  });
  it("adds the missing employee_profiles.hr_location_id", () => {
    expect(sql).toMatch(/ALTER TABLE public\.employee_profiles[\s\S]*hr_location_id uuid REFERENCES public\.hr_locations/);
  });
  it("never reuses the recorded stub version", () => {
    const stub = readFileSync(
      `${migrationsDir}/20260814133024_hr_locations_and_business_unit.sql`,
      "utf8",
    );
    expect(stub).toMatch(/keep-migration-version/);
  });
});

describe("HR security hardening", () => {
  const sql = migration("security");
  it("enforces a column allow-list on self updates", () => {
    expect(sql).toMatch(/guard_employee_self_update/);
    expect(sql).toMatch(/trg_guard_employee_self_update[\s\S]*BEFORE UPDATE ON public\.employee_profiles/);
    expect(sql).toMatch(/employee_self_editable_fields/);
  });
  it("removes client EXECUTE from the HR document helpers", () => {
    expect(sql).toMatch(/REVOKE EXECUTE ON FUNCTION public\.log_hr_document_action[\s\S]*authenticated/);
    expect(sql).toMatch(/REVOKE EXECUTE ON FUNCTION public\.notify_super_admins_hr_document[\s\S]*authenticated/);
  });
  it("stops HR generators mutating approved/issued letters", () => {
    expect(sql).toMatch(/HR updates pending letters/);
    expect(sql).toMatch(/status IN \('draft', 'pending_approval', 'rejected'\)/);
  });
});

describe("Leave engine completion", () => {
  const sql = migration("leave");
  it("adds an approval RPC with a notification", () => {
    expect(sql).toMatch(/FUNCTION public\.decide_leave_request/);
    expect(sql).toMatch(/'leave_decision'/);
  });
  it("lets hr:leave_approve read and action requests", () => {
    expect(sql).toMatch(/HR reads leave requests/);
    expect(sql).toMatch(/HR actions leave requests/);
    expect(sql).toMatch(/hr:leave_approve/);
  });
  it("implements monthly accrual and carry-forward", () => {
    expect(sql).toMatch(/leave_completed_months/);
    expect(sql).toMatch(/leave_entitlement_days/);
    expect(sql).toMatch(/carry_forward_max/);
  });
  it("resolves the plan/type for legacy self-service requests", () => {
    expect(sql).toMatch(/sync_leave_entitlement_usage/);
    expect(sql).toMatch(/WHEN 'casual'/);
  });
});

describe("HR automation is scheduled", () => {
  const sql = migration("automation");
  const jobs = [
    "hr-auto-punch-out",
    "hr-close-due-exits",
    "hr-leave-accrual",
    "hr-doc-expiry-reminders",
    "hr-probation-reminders",
  ];
  for (const job of jobs) {
    it(`schedules ${job}`, () => {
      expect(sql).toContain(`cron.schedule('${job}'`);
    });
  }
  it("widens the notification type constraint for HR events", () => {
    expect(sql).toMatch(/notifications_type_check/);
    expect(sql).toMatch(/expense_decided/);
    expect(sql).toMatch(/announcement_published/);
  });
});

describe("Expenses pillar", () => {
  const sql = migration("expenses");
  it("defines the claims, categories and audit tables", () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.expense_claims/);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.expense_categories/);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.expense_claim_audit/);
  });
  it("exposes decide/reimburse RPCs and the inbox view", () => {
    expect(sql).toMatch(/FUNCTION public\.decide_expense_claim/);
    expect(sql).toMatch(/FUNCTION public\.mark_expense_reimbursed/);
    expect(sql).toMatch(/security_invoker = true/);
  });
});

describe("Performance and engagement pillars", () => {
  it("defines performance tables", () => {
    const sql = migration("performance");
    expect(sql).toMatch(/public\.performance_cycles/);
    expect(sql).toMatch(/public\.performance_reviews/);
    expect(sql).toMatch(/public\.performance_goals/);
    expect(sql).toMatch(/public\.performance_feedback/);
  });
  it("defines engagement + helpdesk tables", () => {
    const sql = migration("engagement");
    expect(sql).toMatch(/public\.announcements/);
    expect(sql).toMatch(/public\.helpdesk_tickets/);
    expect(sql).toMatch(/public\.helpdesk_ticket_messages/);
    expect(sql).toMatch(/public\.recognitions/);
  });
});

describe("HR reports", () => {
  const sql = migration("reports");
  for (const fn of [
    "hr_headcount_summary",
    "hr_attendance_summary",
    "hr_leave_summary",
    "hr_payroll_cost_summary",
    "hr_attrition_summary",
    "hr_recruitment_funnel",
    "hr_expense_summary",
  ]) {
    it(`defines ${fn}`, () => {
      expect(sql).toContain(fn);
    });
  }
});

describe("migration hygiene", () => {
  it("new HR migrations have unique 14-digit versions", () => {
    const all = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql"));
    const versions = all.map((f) => f.match(/^(\d{14})_/)?.[1]).filter(Boolean) as string[];
    const seen = new Set<string>();
    const dupes: string[] = [];
    for (const v of versions) {
      if (seen.has(v)) dupes.push(v);
      seen.add(v);
    }
    expect(dupes).toEqual([]);
  });

  it("locates every new HR migration by slug", () => {
    for (const slug of Object.values(MIGRATIONS)) {
      expect(migrationFile(slug).split("/").pop()).toMatch(/^\d{14}_/);
    }
  });
});

describe("frontend wiring", () => {
  it("registers HR routes behind permission gates", () => {
    const app = read("src/App.tsx");
    const expected: Array<[string, string]> = [
      ["/hr-expenses", 'module="hr" action="expenses_approve"'],
      ["/hr-performance", 'module="hr" action="performance_manage"'],
      ["/hr-announcements", 'module="hr" action="engage_manage"'],
      ["/hr-helpdesk", 'module="hr" action="helpdesk_manage"'],
      ["/hr-reports", 'module="hr" action="view"'],
      ["/hr-settings", 'module="hr" action="employees_edit"'],
    ];
    for (const [path, gate] of expected) {
      expect(app, `route ${path} should be gated`).toContain(`path="${path}"`);
      expect(app).toContain(gate);
    }
  });

  it("adds the new surfaces to the sidebar HR group", () => {
    const sidebar = read("src/components/layout/AppSidebar.tsx");
    for (const url of [
      "/hr-expenses",
      "/hr-performance",
      "/hr-announcements",
      "/hr-helpdesk",
      "/hr-reports",
      "/hr-settings",
    ]) {
      expect(sidebar).toContain(url);
    }
  });

  it("gates leave approval and attendance correction actions", () => {
    const leave = read("src/pages/HrLeaveManagement.tsx");
    expect(leave).toContain('can("hr", "leave_approve")');
    const attendance = read("src/pages/HrAttendance.tsx");
    expect(attendance).toContain('can("hr", "attendance_edit")');
  });

  it("wires MyHr self-service producer panels", () => {
    const myHr = read("src/pages/MyHr.tsx");
    expect(myHr).toMatch(/ChangeRequestForm|RegularisationRequestForm|MyExpensesPanel|MyPerformancePanel|MyEngagementPanel/);
  });
});
