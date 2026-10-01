import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

/**
 * Guardrails for HR phase 4: comp-off, leave encashment and custom employee
 * fields. Migrations are resolved by slug because the pre-commit hook restamps
 * newly-added migrations.
 */

const migrationsDir = "supabase/migrations";
const read = (rel: string) => readFileSync(rel, "utf8");

const migrationFile = (slug: string) => {
  const files = readdirSync(migrationsDir).filter((f) => /^\d{14}_.*\.sql$/.test(f) && f.endsWith(`_${slug}.sql`));
  expect(files.length, `expected exactly one migration named *_${slug}.sql`).toBe(1);
  return `${migrationsDir}/${files[0]}`;
};

describe("comp-off", () => {
  const sql = read(migrationFile("hr_comp_off"));
  it("defines credits with a derived remaining balance", () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.comp_off_credits/);
    expect(sql).toMatch(/remaining\s+numeric\(6,2\) GENERATED ALWAYS AS/);
  });
  it("grants, decides, consumes FIFO and expires credits", () => {
    expect(sql).toMatch(/FUNCTION public\.grant_comp_off/);
    expect(sql).toMatch(/FUNCTION public\.decide_comp_off/);
    expect(sql).toMatch(/FUNCTION public\.consume_comp_off/);
    expect(sql).toMatch(/FUNCTION public\.expire_comp_off_credits/);
  });
  it("seeds a COFF leave type and consumes on leave approval", () => {
    expect(sql).toMatch(/'COFF'/);
    expect(sql).toMatch(/leave_requests_consume_comp_off/);
  });
  it("schedules the expiry job", () => {
    expect(sql).toContain("cron.schedule('hr-comp-off-expiry'");
  });
});

describe("leave encashment", () => {
  const sql = read(migrationFile("hr_leave_encashment"));
  it("defines encashments and the request/decide/pay RPCs", () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.leave_encashments/);
    expect(sql).toMatch(/FUNCTION public\.request_leave_encashment/);
    expect(sql).toMatch(/FUNCTION public\.decide_leave_encashment/);
    expect(sql).toMatch(/FUNCTION public\.pay_leave_encashment/);
  });
  it("consumes the entitlement on payment (not used_days)", () => {
    expect(sql).toMatch(/entitled_days = GREATEST\(entitled_days - enc\.days, 0\)/);
  });
  it("exposes self leave balances and an inbox view", () => {
    expect(sql).toMatch(/FUNCTION public\.my_leave_balances/);
    expect(sql).toMatch(/leave_encashments_inbox/);
    expect(sql).toMatch(/security_invoker = true/);
  });
});

describe("custom employee fields", () => {
  const sql = read(migrationFile("hr_custom_fields"));
  it("defines field definitions and per-employee values", () => {
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.employee_field_defs/);
    expect(sql).toMatch(/CREATE TABLE IF NOT EXISTS public\.employee_field_values/);
  });
  it("exposes set and self-read RPCs", () => {
    expect(sql).toMatch(/FUNCTION public\.set_employee_field_value/);
    expect(sql).toMatch(/FUNCTION public\.my_employee_fields/);
    expect(sql).toMatch(/hr:employees_edit/);
  });
});

describe("phase-4 frontend wiring", () => {
  it("registers the comp-off, encashment and custom-fields routes", () => {
    const app = read("src/App.tsx");
    expect(app).toContain('path="/hr-comp-off"');
    expect(app).toContain('path="/hr-encashment"');
    expect(app).toContain('path="/hr-custom-fields"');
    expect(app).toContain('module="hr" action="attendance_edit"');
    expect(app).toContain('module="hr" action="leave_approve"');
  });

  it("adds the surfaces to the sidebar", () => {
    const sidebar = read("src/components/layout/AppSidebar.tsx");
    expect(sidebar).toContain("/hr-comp-off");
    expect(sidebar).toContain("/hr-encashment");
    expect(sidebar).toContain("/hr-custom-fields");
  });

  it("embeds the self-service panels in MyHr", () => {
    const myHr = read("src/pages/MyHr.tsx");
    expect(myHr).toMatch(/MyCompOffPanel/);
    expect(myHr).toMatch(/MyEncashmentPanel/);
    expect(myHr).toMatch(/MyCustomFieldsPanel/);
  });
});
