import { describe, it, expect } from "vitest";
import {
  ADVANCE_STATUSES,
  advanceStatusBadge,
  formatInr,
  isFullyRecovered,
  outstandingOf,
  summarizeAdvances,
  type AdvanceRow,
} from "./advances";

const advance = (over: Partial<AdvanceRow> = {}): AdvanceRow => ({
  id: "adv-1",
  employee_profile_id: "emp-1",
  amount: 10000,
  recovered_amount: 0,
  outstanding: 10000,
  issued_on: "2026-09-01",
  purpose: "Travel",
  status: "open",
  payroll_cycle_id: null,
  settled_at: null,
  notes: null,
  employee_name: "Asha Rao",
  employee_number: "EMP-001",
  ...over,
});

describe("ADVANCE_STATUSES", () => {
  it("covers the full lifecycle the DB CHECK allows", () => {
    expect([...ADVANCE_STATUSES].sort()).toEqual(["cancelled", "open", "recovered"]);
  });
});

describe("advanceStatusBadge", () => {
  it("maps each known status to a pastel pill", () => {
    expect(advanceStatusBadge("open")).toContain("bg-pastel-yellow");
    expect(advanceStatusBadge("recovered")).toContain("bg-pastel-green");
    expect(advanceStatusBadge("cancelled")).toContain("bg-muted");
  });

  it("never returns undefined for an unexpected status", () => {
    expect(advanceStatusBadge("mystery")).toContain("bg-muted");
  });
});

describe("formatInr", () => {
  it("groups in the Indian numbering system", () => {
    expect(formatInr(0)).toBe("0");
    expect(formatInr(1500)).toBe("1,500");
    expect(formatInr(1234567)).toBe("12,34,567");
  });

  it("keeps up to two decimals and tolerates string/numeric input", () => {
    expect(formatInr(1500.5)).toBe("1,500.5");
    expect(formatInr("1234.25")).toBe("1,234.25");
    expect(formatInr(null)).toBe("0");
  });
});

describe("outstandingOf", () => {
  it("prefers the database's generated outstanding value", () => {
    expect(outstandingOf(advance({ amount: 10000, recovered_amount: 4000, outstanding: 6000 }))).toBe(6000);
  });

  it("derives the balance when the column is absent", () => {
    expect(outstandingOf({ amount: 10000, recovered_amount: 2500 })).toBe(7500);
  });

  it("coerces numeric-as-string amounts from Postgres", () => {
    expect(outstandingOf({ amount: "5000.50", recovered_amount: "1000.50" })).toBe(4000);
  });

  it("never reports a negative balance", () => {
    expect(outstandingOf({ amount: 1000, recovered_amount: 1500 })).toBe(0);
    expect(outstandingOf(advance({ outstanding: -100 }))).toBe(0);
  });
});

describe("isFullyRecovered", () => {
  it("is true when nothing is left outstanding", () => {
    expect(isFullyRecovered(advance({ recovered_amount: 10000, outstanding: 0, status: "recovered" }))).toBe(true);
  });

  it("is false for an open or partially-recovered advance", () => {
    expect(isFullyRecovered(advance({ recovered_amount: 0, outstanding: 10000 }))).toBe(false);
    expect(isFullyRecovered(advance({ recovered_amount: 2500, outstanding: 7500 }))).toBe(false);
  });

  it("does not treat a cancelled advance as recovered", () => {
    expect(isFullyRecovered(advance({ status: "cancelled", recovered_amount: 0, outstanding: 10000 }))).toBe(false);
  });
});

describe("summarizeAdvances", () => {
  const rows: AdvanceRow[] = [
    advance({ id: "a", status: "open", amount: 10000, recovered_amount: 0, outstanding: 10000 }),
    advance({ id: "b", status: "open", amount: 5000, recovered_amount: 2000, outstanding: 3000 }),
    advance({ id: "c", status: "recovered", amount: 8000, recovered_amount: 8000, outstanding: 0 }),
    advance({ id: "d", status: "cancelled", amount: 4000, recovered_amount: 0, outstanding: 4000 }),
  ];

  it("counts open advances and totals the money buckets", () => {
    const s = summarizeAdvances(rows);
    expect(s.open).toBe(2);
    expect(s.outstanding).toBe(13000);
    expect(s.recovered).toBe(10000);
    expect(s.total).toBe(27000);
  });

  it("is all zeros for an empty list", () => {
    expect(summarizeAdvances([])).toEqual({ open: 0, outstanding: 0, recovered: 0, total: 0 });
  });

  it("coerces numeric-as-string amounts from Postgres", () => {
    const s = summarizeAdvances([
      advance({ status: "open", amount: "1500.50", recovered_amount: "0.50", outstanding: "1500" }),
    ]);
    expect(s.open).toBe(1);
    expect(s.outstanding).toBe(1500);
    expect(s.recovered).toBe(0.5);
    expect(s.total).toBe(1500.5);
  });
});
