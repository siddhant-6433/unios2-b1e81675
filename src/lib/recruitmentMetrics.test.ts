import { describe, it, expect } from "vitest";
import {
  metricValue,
  metricLabel,
  metricFormat,
  formatMetric,
  funnelStatuses,
  funnelSources,
  funnelMatrix,
  acceptanceTone,
  defaultRange,
  HEADLINE_METRICS,
} from "@/lib/recruitmentMetrics";

describe("recruitmentMetrics", () => {
  const rows = [
    { metric: "applicants", value: 42 },
    { metric: "hired", value: 3 },
    { metric: "offer_acceptance_pct", value: 66.7 },
    { metric: "avg_days_to_hire", value: 12.5 },
  ];

  it("reads metric values with a safe default", () => {
    expect(metricValue(rows, "applicants")).toBe(42);
    expect(metricValue(rows, "missing")).toBe(0);
    expect(metricValue(null, "applicants")).toBe(0);
  });

  it("labels known and unknown metrics", () => {
    expect(metricLabel("offer_acceptance_pct")).toBe("Offer acceptance");
    expect(metricLabel("some_new_metric")).toBe("Some New Metric");
  });

  it("formats metrics by kind", () => {
    expect(metricFormat("applicants")).toBe("int");
    expect(metricFormat("offer_acceptance_pct")).toBe("pct");
    expect(metricFormat("avg_days_to_hire")).toBe("days");
    expect(formatMetric("applicants", 1234)).toBe("1,234");
    expect(formatMetric("offer_acceptance_pct", 66.7)).toBe("66.7%");
    expect(formatMetric("avg_days_to_hire", 12.5)).toBe("12.5d");
  });

  it("orders funnel statuses by the pipeline, appending unknown ones", () => {
    const st = funnelStatuses([
      { status: "hired", source: "x", applicants: 1 },
      { status: "new", source: "x", applicants: 2 },
      { status: "on_hold", source: "x", applicants: 1 },
    ]);
    expect(st).toEqual(["new", "hired", "on_hold"]);
  });

  it("derives sources and a status×source matrix", () => {
    const data = [
      { status: "new", source: "careers_portal", applicants: 5 },
      { status: "new", source: "whatsapp", applicants: 2 },
      { status: "hired", source: "whatsapp", applicants: 1 },
    ];
    expect(funnelSources(data)).toEqual(["careers_portal", "whatsapp"]);
    const m = funnelMatrix(data);
    expect(m.cell("new", "careers_portal")).toBe(5);
    expect(m.cell("new", "whatsapp")).toBe(2);
    expect(m.cell("hired", "careers_portal")).toBe(0);
  });

  it("tones acceptance and defaults the range to 90 days", () => {
    expect(acceptanceTone(80)).toContain("green");
    expect(acceptanceTone(50)).toContain("yellow");
    expect(acceptanceTone(10)).toContain("red");
    const r = defaultRange(new Date("2026-06-30T00:00:00Z"));
    expect(r.to).toBe("2026-06-30");
    expect(r.from).toBe("2026-04-01");
  });

  it("has a label for every headline metric", () => {
    for (const key of HEADLINE_METRICS) expect(metricLabel(key)).not.toBe(key.replace(/_/g, " "));
  });
});
