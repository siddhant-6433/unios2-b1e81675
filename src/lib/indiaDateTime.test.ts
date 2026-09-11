import { describe, expect, it } from "vitest";
import { formatCompactINR } from "./formatCompactINR";
import {
  addCalendarDays,
  combineIndiaDateTimeInput,
  indiaDayEndExclusiveIso,
  indiaDayStartIso,
} from "./indiaDateTime";

describe("IST collection day bounds", () => {
  it("pins midnight to +05:30 so evening IST receipts stay on the same calendar day", () => {
    expect(indiaDayStartIso("2026-09-10")).toBe("2026-09-10T00:00:00+05:30");
    expect(indiaDayEndExclusiveIso("2026-09-10")).toBe("2026-09-11T00:00:00+05:30");
    expect(combineIndiaDateTimeInput("2026-09-10", "19:41")).toBe("2026-09-10T19:41:00+05:30");
  });

  it("rolls across month ends without using the browser timezone", () => {
    expect(addCalendarDays("2026-09-30", 1)).toBe("2026-10-01");
    expect(indiaDayEndExclusiveIso("2026-09-30")).toBe("2026-10-01T00:00:00+05:30");
  });
});

describe("formatCompactINR", () => {
  it("keeps header and receipts cards on the same unit", () => {
    expect(formatCompactINR(50_000)).toBe("₹50.0K");
    expect(formatCompactINR(104_800)).toBe("₹1.0L");
    expect(formatCompactINR(69_350_000)).toBe("₹693.5L");
  });
});
