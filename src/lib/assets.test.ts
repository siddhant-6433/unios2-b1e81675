import { describe, it, expect } from "vitest";
import {
  ASSET_STATUSES,
  assetStatusBadge,
  assetStatusLabel,
  isActiveAssignment,
  isAssigned,
  formatInr,
  summarizeAssets,
  type Asset,
} from "./assets";

const asset = (over: Partial<Asset> = {}): Pick<Asset, "status" | "purchase_cost"> => ({
  status: "available",
  purchase_cost: 1000,
  ...over,
});

describe("ASSET_STATUSES", () => {
  it("covers the full set the DB CHECK allows", () => {
    expect([...ASSET_STATUSES].sort()).toEqual(
      ["assigned", "available", "lost", "maintenance", "retired"],
    );
  });
});

describe("assetStatusBadge", () => {
  it("maps each known status to a pastel pill", () => {
    expect(assetStatusBadge("available")).toContain("bg-pastel-blue");
    expect(assetStatusBadge("assigned")).toContain("bg-pastel-green");
    expect(assetStatusBadge("maintenance")).toContain("bg-pastel-yellow");
    expect(assetStatusBadge("lost")).toContain("bg-pastel-red");
    expect(assetStatusBadge("retired")).toContain("bg-muted");
  });

  it("never returns undefined for an unexpected status", () => {
    expect(assetStatusBadge("mystery")).toContain("bg-muted");
  });
});

describe("assetStatusLabel", () => {
  it("capitalises the status for display", () => {
    expect(assetStatusLabel("maintenance")).toBe("Maintenance");
    expect(assetStatusLabel("lost")).toBe("Lost");
    expect(assetStatusLabel("")).toBe("");
  });
});

describe("isAssigned", () => {
  it("is true only while the asset is out on loan", () => {
    expect(isAssigned({ status: "assigned" })).toBe(true);
    expect(isAssigned({ status: "available" })).toBe(false);
    expect(isAssigned({ status: "maintenance" })).toBe(false);
  });

  it("tolerates a missing asset", () => {
    expect(isAssigned(null)).toBe(false);
    expect(isAssigned(undefined)).toBe(false);
  });
});

describe("isActiveAssignment", () => {
  it("is true until the assignment is returned", () => {
    expect(isActiveAssignment({ returned_at: null })).toBe(true);
    expect(isActiveAssignment({ returned_at: "2026-01-01T00:00:00Z" })).toBe(false);
    expect(isActiveAssignment(null)).toBe(false);
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

describe("summarizeAssets", () => {
  const rows = [
    asset({ status: "available", purchase_cost: 500 }),
    asset({ status: "assigned", purchase_cost: 1200 }),
    asset({ status: "assigned", purchase_cost: 800 }),
    asset({ status: "maintenance", purchase_cost: 2000 }),
    asset({ status: "retired", purchase_cost: 300 }),
    asset({ status: "lost", purchase_cost: 999 }),
  ];

  it("totals every asset and buckets count + cost by status", () => {
    const s = summarizeAssets(rows);
    expect(s.total).toBe(6);
    expect(s.totalCost).toBe(5799);
    expect(s.byStatus.available).toEqual({ count: 1, cost: 500 });
    expect(s.byStatus.assigned).toEqual({ count: 2, cost: 2000 });
    expect(s.byStatus.maintenance).toEqual({ count: 1, cost: 2000 });
    expect(s.byStatus.lost).toEqual({ count: 1, cost: 999 });
  });

  it("is all zeros for an empty list", () => {
    const s = summarizeAssets([]);
    expect(s.total).toBe(0);
    expect(s.totalCost).toBe(0);
    for (const status of ASSET_STATUSES) {
      expect(s.byStatus[status]).toEqual({ count: 0, cost: 0 });
    }
  });

  it("coerces numeric-as-string costs from Postgres and ignores null", () => {
    const s = summarizeAssets([
      { status: "available", purchase_cost: "1500.50" },
      { status: "assigned", purchase_cost: null },
    ]);
    expect(s.total).toBe(2);
    expect(s.totalCost).toBe(1500.5);
    expect(s.byStatus.available.cost).toBe(1500.5);
    expect(s.byStatus.assigned).toEqual({ count: 1, cost: 0 });
  });
});
