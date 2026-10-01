import { describe, it, expect } from "vitest";
import {
  COMP_OFF_STATUSES,
  availableOf,
  compOffSourceLabel,
  compOffStatusBadge,
  compOffStatusLabel,
  formatDays,
  summarizeCompOff,
  type CompOffCredit,
} from "./compOff";

const credit = (over: Partial<CompOffCredit> = {}): CompOffCredit => ({
  id: "c1",
  employee_profile_id: "emp-1",
  earned_on: "2026-01-01",
  days: 1,
  used_days: 0,
  remaining: 1,
  reason: null,
  source: "manual",
  status: "approved",
  approved_at: null,
  expires_on: null,
  ...over,
});

describe("COMP_OFF_STATUSES", () => {
  it("covers the full lifecycle the DB CHECK allows", () => {
    expect([...COMP_OFF_STATUSES].sort()).toEqual(
      ["approved", "expired", "pending", "rejected", "used"],
    );
  });
});

describe("compOffStatusBadge", () => {
  it("maps each known status to a pastel pill", () => {
    expect(compOffStatusBadge("pending")).toContain("bg-pastel-yellow");
    expect(compOffStatusBadge("approved")).toContain("bg-pastel-green");
    expect(compOffStatusBadge("rejected")).toContain("bg-pastel-red");
    expect(compOffStatusBadge("used")).toContain("bg-pastel-blue");
    expect(compOffStatusBadge("expired")).toContain("bg-muted");
  });

  it("never returns undefined for an unexpected status", () => {
    expect(compOffStatusBadge("mystery")).toContain("bg-muted");
  });
});

describe("compOffStatusLabel", () => {
  it("capitalises the status for display", () => {
    expect(compOffStatusLabel("pending")).toBe("Pending");
    expect(compOffStatusLabel("approved")).toBe("Approved");
    expect(compOffStatusLabel("used")).toBe("Used");
    expect(compOffStatusLabel("")).toBe("");
  });
});

describe("compOffSourceLabel", () => {
  it("names the known sources and falls back safely", () => {
    expect(compOffSourceLabel("overtime")).toBe("Overtime");
    expect(compOffSourceLabel("holiday_work")).toBe("Holiday work");
    expect(compOffSourceLabel("weekend")).toBe("Weekend");
    expect(compOffSourceLabel("manual")).toBe("Granted");
    expect(compOffSourceLabel("something-else")).toBe("Granted");
  });
});

describe("formatDays", () => {
  it("trims to at most two decimals and tolerates string/null input", () => {
    expect(formatDays(2)).toBe("2");
    expect(formatDays(1.5)).toBe("1.5");
    expect(formatDays("2.50")).toBe("2.5");
    expect(formatDays(0)).toBe("0");
    expect(formatDays(null)).toBe("0");
    expect(formatDays(undefined)).toBe("0");
  });
});

describe("availableOf", () => {
  it("sums remaining only across approved, unexpired credits", () => {
    const rows = [
      credit({ status: "approved", remaining: 2 }),
      credit({ status: "approved", remaining: 1.5 }),
      credit({ status: "pending", remaining: 9 }),
      credit({ status: "used", remaining: 0 }),
      credit({ status: "rejected", remaining: 4 }),
      credit({ status: "expired", remaining: 3 }),
    ];
    expect(availableOf(rows, "2026-06-01")).toBe(3.5);
  });

  it("drops an approved credit once it has expired", () => {
    const rows = [credit({ status: "approved", remaining: 2, expires_on: "2026-03-01" })];
    expect(availableOf(rows, "2026-02-28")).toBe(2);
    expect(availableOf(rows, "2026-03-01")).toBe(2);
    expect(availableOf(rows, "2026-03-02")).toBe(0);
  });

  it("rounds floating addition back to two decimals", () => {
    const rows = [
      credit({ status: "approved", remaining: 0.1 }),
      credit({ status: "approved", remaining: 0.2 }),
    ];
    expect(availableOf(rows)).toBe(0.3);
  });

  it("is zero for an empty list", () => {
    expect(availableOf([])).toBe(0);
  });
});

describe("summarizeCompOff", () => {
  const rows = [
    credit({ status: "pending", days: 2, remaining: 2 }),
    credit({ status: "approved", days: 3, used_days: 1, remaining: 2 }),
    credit({ status: "approved", days: 1, used_days: 0, remaining: 1 }),
    credit({ status: "used", days: 2, used_days: 2, remaining: 0 }),
    credit({ status: "rejected", days: 5, remaining: 5 }),
    credit({ status: "expired", days: 1, remaining: 1 }),
  ];

  it("counts each status and totals the day buckets", () => {
    const s = summarizeCompOff(rows, "2026-06-01");
    expect(s.total).toBe(6);
    expect(s.pending).toBe(1);
    expect(s.approved).toBe(2);
    expect(s.rejected).toBe(1);
    expect(s.used).toBe(1);
    expect(s.expired).toBe(1);
    expect(s.availableDays).toBe(3);
    expect(s.usedDays).toBe(3);
  });

  it("is all zeros for an empty list", () => {
    expect(summarizeCompOff([])).toEqual({
      total: 0,
      pending: 0,
      approved: 0,
      rejected: 0,
      used: 0,
      expired: 0,
      availableDays: 0,
      usedDays: 0,
    });
  });

  it("coerces numeric-as-string columns from Postgres", () => {
    const s = summarizeCompOff([
      { status: "approved", days: "2", used_days: "0.5", remaining: "1.50", expires_on: null },
    ]);
    expect(s.availableDays).toBe(1.5);
    expect(s.usedDays).toBe(0.5);
  });
});
