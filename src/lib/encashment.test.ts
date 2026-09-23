import { describe, it, expect } from "vitest";
import {
  ENCASHMENT_STATUSES,
  availableFor,
  balancesWithAvailable,
  encashmentStatusBadge,
  encashmentStatusLabel,
  formatInr,
  summarizeEncashments,
  totalAvailable,
  type EncashmentRow,
  type LeaveBalance,
} from "./encashment";

const enc = (over: Partial<EncashmentRow> = {}): Pick<EncashmentRow, "status" | "amount"> => ({
  status: "requested",
  amount: 1000,
  ...over,
});

const balance = (over: Partial<LeaveBalance> = {}): LeaveBalance => ({
  leave_type_id: "lt-1",
  leave_type: "Earned",
  leave_year: 2026,
  entitled: 12,
  carried_forward: 0,
  used: 2,
  available: 10,
  ...over,
});

describe("ENCASHMENT_STATUSES", () => {
  it("covers the full lifecycle the DB CHECK allows", () => {
    expect([...ENCASHMENT_STATUSES].sort()).toEqual(
      ["approved", "cancelled", "paid", "rejected", "requested"],
    );
  });
});

describe("encashmentStatusBadge", () => {
  it("maps each known status to a pastel pill", () => {
    expect(encashmentStatusBadge("requested")).toContain("bg-pastel-yellow");
    expect(encashmentStatusBadge("approved")).toContain("bg-pastel-green");
    expect(encashmentStatusBadge("paid")).toContain("bg-pastel-blue");
    expect(encashmentStatusBadge("rejected")).toContain("bg-pastel-red");
    expect(encashmentStatusBadge("cancelled")).toContain("bg-muted");
  });

  it("never returns undefined for an unexpected status", () => {
    expect(encashmentStatusBadge("mystery")).toContain("bg-muted");
  });
});

describe("encashmentStatusLabel", () => {
  it("capitalises the status for display", () => {
    expect(encashmentStatusLabel("requested")).toBe("Requested");
    expect(encashmentStatusLabel("paid")).toBe("Paid");
    expect(encashmentStatusLabel("")).toBe("");
  });
});

describe("formatInr", () => {
  it("groups in the Indian numbering system and tolerates strings", () => {
    expect(formatInr(0)).toBe("0");
    expect(formatInr(1500)).toBe("1,500");
    expect(formatInr("1234.25")).toBe("1,234.25");
    expect(formatInr(null)).toBe("0");
  });
});

describe("summarizeEncashments", () => {
  const rows = [
    enc({ status: "requested", amount: 500 }),
    enc({ status: "requested", amount: 250 }),
    enc({ status: "approved", amount: 1200 }),
    enc({ status: "paid", amount: 2000 }),
    enc({ status: "rejected", amount: 300 }),
    enc({ status: "cancelled", amount: 999 }),
  ];

  it("counts each status and buckets the rupee amounts", () => {
    const s = summarizeEncashments(rows);
    expect(s.total).toBe(6);
    expect(s.requested).toBe(2);
    expect(s.approved).toBe(1);
    expect(s.paid).toBe(1);
    expect(s.rejected).toBe(1);
    expect(s.requestedAmount).toBe(750);
    expect(s.approvedAmount).toBe(1200);
    expect(s.paidAmount).toBe(2000);
  });

  it("is all zeros for an empty list", () => {
    expect(summarizeEncashments([])).toEqual({
      total: 0,
      requested: 0,
      approved: 0,
      paid: 0,
      rejected: 0,
      requestedAmount: 0,
      approvedAmount: 0,
      paidAmount: 0,
    });
  });

  it("coerces numeric-as-string amounts from Postgres", () => {
    const s = summarizeEncashments([{ status: "requested", amount: "1500.50" }]);
    expect(s.requestedAmount).toBe(1500.5);
  });
});

describe("balancesWithAvailable", () => {
  it("keeps only balances with something left, newest year first", () => {
    const rows = balancesWithAvailable([
      balance({ leave_type_id: "lt-b", leave_type: "Sick", leave_year: 2025, available: 3 }),
      balance({ leave_type_id: "lt-a", leave_type: "Earned", leave_year: 2026, available: 5 }),
      balance({ leave_type_id: "lt-c", leave_type: "Casual", leave_year: 2026, available: 0 }),
      balance({ leave_type_id: "lt-d", leave_type: "Unpaid", leave_year: 2026, available: "0.00" }),
    ]);
    expect(rows.map((b) => b.leave_type_id)).toEqual(["lt-a", "lt-b"]);
  });

  it("is empty when nothing is available", () => {
    expect(balancesWithAvailable([balance({ available: 0 })])).toEqual([]);
  });
});

describe("totalAvailable / availableFor", () => {
  it("sums available days and looks one balance up by type and year", () => {
    const rows = [
      balance({ leave_type_id: "lt-1", leave_year: 2026, available: 5 }),
      balance({ leave_type_id: "lt-2", leave_year: 2026, available: 2.5 }),
    ];
    expect(totalAvailable(rows)).toBe(7.5);
    expect(availableFor(rows, "lt-2", 2026)).toBe(2.5);
    expect(availableFor(rows, "lt-2", 2024)).toBe(0);
    expect(availableFor(rows, "missing", 2026)).toBe(0);
  });
});
