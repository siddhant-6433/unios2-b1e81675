import { describe, it, expect } from "vitest";
import { buildRows } from "./AddFeeHeadDialog";

describe("buildRows", () => {
  it("monthly: one row per month, due 10th, amount = per-month rate", () => {
    const rows = buildRows("2026-07", 3, "monthly", 800);
    expect(rows).toEqual([
      { term: "m_2026_07", amount: 800, due_date: "2026-07-10", label: "Jul 2026" },
      { term: "m_2026_08", amount: 800, due_date: "2026-08-10", label: "Aug 2026" },
      { term: "m_2026_09", amount: 800, due_date: "2026-09-10", label: "Sep 2026" },
    ]);
  });

  it("quarterly: steps 3 months, charges 3× the monthly rate", () => {
    const rows = buildRows("2026-07", 2, "quarterly", 3000);
    expect(rows.map(r => r.term)).toEqual(["m_2026_07", "m_2026_10"]);
    expect(rows.map(r => r.amount)).toEqual([9000, 9000]);
    expect(rows.map(r => r.due_date)).toEqual(["2026-07-10", "2026-10-10"]);
  });

  it("rolls over the year boundary", () => {
    const rows = buildRows("2026-11", 3, "monthly", 500);
    expect(rows.map(r => r.term)).toEqual(["m_2026_11", "m_2026_12", "m_2027_01"]);
  });

  it("returns nothing without a rate/start/count", () => {
    expect(buildRows("", 3, "monthly", 800)).toEqual([]);
    expect(buildRows("2026-07", 0, "monthly", 800)).toEqual([]);
    expect(buildRows("2026-07", 3, "monthly", 0)).toEqual([]);
  });
});
