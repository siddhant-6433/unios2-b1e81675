import { describe, expect, it } from "vitest";
import {
  BEACON_TRANSPORT_RATES,
  beaconTransportDefaultMonthlyAmount,
  beaconTransportSessionDefaultMonthlyAmount,
  beaconTransportQuarterDueDate,
  beaconTransportQuarterTotals,
} from "./beaconTransportFees";

describe("Beacon transport assignment pricing", () => {
  it("uses the statement monthly rates and halves them for one-way travel", () => {
    expect(Object.values(BEACON_TRANSPORT_RATES).map(({ monthly }) => monthly)).toEqual([2000, 2500, 3500]);
    expect(beaconTransportDefaultMonthlyAmount("zone_1", true)).toBe(1000);
    expect(beaconTransportDefaultMonthlyAmount("zone_2", true)).toBe(1250);
    expect(beaconTransportDefaultMonthlyAmount("zone_3", true)).toBe(1750);
  });

  it("uses the correct defaults for each academic session", () => {
    expect(beaconTransportSessionDefaultMonthlyAmount("2026-27", "zone_1", false)).toBe(1800);
    expect(beaconTransportSessionDefaultMonthlyAmount("2026-27", "zone_1", true)).toBe(900);
    expect(beaconTransportSessionDefaultMonthlyAmount("2027-28", "zone_1", false)).toBe(2000);
  });

  it("aggregates selected months into the correct quarterly amounts", () => {
    expect(beaconTransportQuarterTotals([4, 5, 7, 1, 3], 900)).toEqual({ q1: 1800, q2: 900, q3: 0, q4: 1800 });
  });

  it("supports reduced monthly rates without changing month totals", () => {
    expect(beaconTransportQuarterTotals([4, 5, 6, 7, 8, 9], 750)).toEqual({ q1: 2250, q2: 2250, q3: 0, q4: 0 });
  });

  it("uses the published quarter dates, including January in the following year", () => {
    expect(beaconTransportQuarterDueDate("q1", 2027)).toBe("2027-04-10");
    expect(beaconTransportQuarterDueDate("q2", 2027)).toBe("2027-07-10");
    expect(beaconTransportQuarterDueDate("q3", 2027)).toBe("2027-10-10");
    expect(beaconTransportQuarterDueDate("q4", 2027)).toBe("2028-01-10");
  });
});
