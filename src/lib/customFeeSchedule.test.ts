import { describe, it, expect } from "vitest";
import { buildFeeSchedule, perRowAmount } from "./customFeeSchedule";

describe("customFeeSchedule", () => {
  it("batches a ₹3,000/month meal fee into 4 quarterly rows of ₹9,000", () => {
    const rows = buildFeeSchedule({
      frequency: "quarterly",
      monthlyAmount: 3000,
      periods: [1, 2, 3, 4],
      anchorYear: 2026,
    });
    expect(rows).toEqual([
      { term: "q1", amount: 9000, due_date: "2026-04-10" },
      { term: "q2", amount: 9000, due_date: "2026-07-10" },
      { term: "q3", amount: 9000, due_date: "2026-10-10" },
      { term: "q4", amount: 9000, due_date: "2027-01-10" }, // q4 rolls into next calendar year
    ]);
  });

  it("emits one row per selected month, rolling Jan-Mar into the next year", () => {
    const rows = buildFeeSchedule({
      frequency: "monthly",
      monthlyAmount: 2000,
      periods: [4, 12, 1],
      anchorYear: 2026,
    });
    expect(rows).toEqual([
      { term: "m_2027_01", amount: 2000, due_date: "2027-01-10" },
      { term: "m_2026_04", amount: 2000, due_date: "2026-04-10" },
      { term: "m_2026_12", amount: 2000, due_date: "2026-12-10" },
    ]);
  });

  it("annually bills 12 months per year row, staggered by ordinal", () => {
    const rows = buildFeeSchedule({
      frequency: "annually",
      monthlyAmount: 1000,
      periods: [1, 2],
      anchorYear: 2026,
    });
    expect(rows).toEqual([
      { term: "year_1", amount: 12000, due_date: "2026-04-10" },
      { term: "year_2", amount: 12000, due_date: "2027-04-10" },
    ]);
  });

  it("one_time is a single row at session start with the raw amount", () => {
    const rows = buildFeeSchedule({
      frequency: "one_time",
      monthlyAmount: 5000,
      periods: [],
      anchorYear: 2026,
    });
    expect(rows).toEqual([{ term: "one_time", amount: 5000, due_date: "2026-04-10" }]);
  });

  it("respects a custom due day, clamped to 28", () => {
    const [row] = buildFeeSchedule({
      frequency: "quarterly",
      monthlyAmount: 1000,
      periods: [1],
      anchorYear: 2026,
      dueDay: 31,
    });
    expect(row.due_date).toBe("2026-04-28");
  });

  it("perRowAmount batches by frequency", () => {
    expect(perRowAmount(3000, "monthly")).toBe(3000);
    expect(perRowAmount(3000, "quarterly")).toBe(9000);
    expect(perRowAmount(3000, "annually")).toBe(36000);
    expect(perRowAmount(3000, "one_time")).toBe(3000);
  });
});
