import { describe, expect, it } from "vitest";
import { effectiveConcessionAmount, summarizeConcessionLedger } from "@/lib/feeConcession";

describe("effectiveConcessionAmount", () => {
  it("treats a flat concession as its rupee value", () => {
    expect(effectiveConcessionAmount("flat", 5000, 120000)).toBe(5000);
  });

  it("treats a percentage concession as a share of the ledger head", () => {
    expect(effectiveConcessionAmount("percentage", 10, 120000)).toBe(12000);
    expect(effectiveConcessionAmount("percentage", 7.5, 100000)).toBe(7500);
  });

  it("rounds percentages to the nearest rupee", () => {
    expect(effectiveConcessionAmount("percentage", 33, 1000)).toBe(330);
    expect(effectiveConcessionAmount("percentage", 12.5, 999)).toBe(125);
  });

  it("returns zero for missing or non-positive values", () => {
    expect(effectiveConcessionAmount("flat", 0, 120000)).toBe(0);
    expect(effectiveConcessionAmount("percentage", null, 120000)).toBe(0);
    expect(effectiveConcessionAmount("flat", 5000, null)).toBe(5000); // flat is amount-only
    expect(effectiveConcessionAmount("percentage", 10, null)).toBe(0);
  });
});

describe("summarizeConcessionLedger", () => {
  it("shows the net payable after waiving a head with no prior concession", () => {
    expect(
      summarizeConcessionLedger({ total: 120000, existing: 0, type: "flat", value: 20000, paid: 0 }),
    ).toEqual({ total: 120000, existing: 0, requested: 20000, netAfterWaiver: 100000, paid: 0, projectedBalance: 100000 });
  });

  it("stacks this request on top of an existing offer waiver", () => {
    // ₹120,000 head, ₹30,000 already waived via offer letter, ₹12,000 (10%)
    // requested now → net ₹78,000.
    const s = summarizeConcessionLedger({ total: 120000, existing: 30000, type: "percentage", value: 10, paid: 0 });
    expect(s.requested).toBe(12000);
    expect(s.netAfterWaiver).toBe(78000);
  });

  it("subtracts what is already paid to project the balance", () => {
    const s = summarizeConcessionLedger({ total: 100000, existing: 0, type: "flat", value: 40000, paid: 25000 });
    expect(s.netAfterWaiver).toBe(60000);
    expect(s.projectedBalance).toBe(35000);
  });

  it("never lets the waiver drive the head or balance negative", () => {
    const s = summarizeConcessionLedger({ total: 50000, existing: 30000, type: "flat", value: 40000, paid: 10000 });
    expect(s.netAfterWaiver).toBe(0);
    expect(s.projectedBalance).toBe(0);
  });

  it("caps existing concession at the head amount", () => {
    const s = summarizeConcessionLedger({ total: 50000, existing: 90000, type: "flat", value: 0 });
    expect(s.existing).toBe(50000);
    expect(s.netAfterWaiver).toBe(0);
  });

  it("handles missing numbers as zero", () => {
    expect(summarizeConcessionLedger({ total: null, existing: null, type: "flat", value: 5000, paid: null })).toEqual({
      total: 0, existing: 0, requested: 5000, netAfterWaiver: 0, paid: 0, projectedBalance: 0,
    });
  });
});
