import { describe, it, expect } from "vitest";
import {
  ONBOARDING_STAGES,
  stageIndex,
  nextStage,
  stageLabel,
  stageBadge,
  isCandidate,
  progressPct,
} from "./onboarding";

describe("ONBOARDING_STAGES — the DB CHECK, in order", () => {
  it("lists the six lifecycle stages candidate → employee", () => {
    expect([...ONBOARDING_STAGES]).toEqual([
      "candidate",
      "documents",
      "offer_generated",
      "offer_accepted",
      "login_created",
      "employee",
    ]);
  });
});

describe("stageIndex", () => {
  it("returns the zero-based position", () => {
    expect(stageIndex("candidate")).toBe(0);
    expect(stageIndex("documents")).toBe(1);
    expect(stageIndex("offer_generated")).toBe(2);
    expect(stageIndex("offer_accepted")).toBe(3);
    expect(stageIndex("login_created")).toBe(4);
    expect(stageIndex("employee")).toBe(5);
  });

  it("returns -1 for unknown or missing stages", () => {
    expect(stageIndex("mystery")).toBe(-1);
    expect(stageIndex(null)).toBe(-1);
    expect(stageIndex(undefined)).toBe(-1);
    expect(stageIndex("")).toBe(-1);
  });
});

describe("nextStage — forward-only, stops at the terminal stage", () => {
  it("walks the pipeline in order", () => {
    expect(nextStage("candidate")).toBe("documents");
    expect(nextStage("documents")).toBe("offer_generated");
    expect(nextStage("offer_generated")).toBe("offer_accepted");
    expect(nextStage("offer_accepted")).toBe("login_created");
    expect(nextStage("login_created")).toBe("employee");
  });

  it("does not advance past employee", () => {
    expect(nextStage("employee")).toBeNull();
  });

  it("does not invent a next stage for unknown values", () => {
    expect(nextStage("mystery")).toBeNull();
    expect(nextStage(null)).toBeNull();
    expect(nextStage(undefined)).toBeNull();
  });
});

describe("stageLabel", () => {
  it("maps every stage to a label", () => {
    expect(stageLabel("candidate")).toBe("Candidate");
    expect(stageLabel("offer_generated")).toBe("Offer Generated");
    expect(stageLabel("login_created")).toBe("Login Created");
    expect(stageLabel("employee")).toBe("Employee");
  });

  it("falls back to a de-underscored raw value, never undefined", () => {
    expect(stageLabel("some_new_stage")).toBe("some new stage");
    expect(stageLabel(null)).toBe("Unknown");
  });
});

describe("stageBadge", () => {
  it("maps each stage to a pastel pill", () => {
    expect(stageBadge("candidate")).toContain("bg-pastel-blue");
    expect(stageBadge("documents")).toContain("bg-pastel-yellow");
    expect(stageBadge("offer_generated")).toContain("bg-pastel-purple");
    expect(stageBadge("offer_accepted")).toContain("bg-pastel-green");
    expect(stageBadge("login_created")).toContain("bg-pastel-mint");
    expect(stageBadge("employee")).toContain("bg-muted");
  });

  it("returns a muted class for unknown or missing stages", () => {
    expect(stageBadge("mystery")).toContain("bg-muted");
    expect(stageBadge(null)).toContain("bg-muted");
  });
});

describe("isCandidate", () => {
  it("is true only at the top of the funnel", () => {
    expect(isCandidate({ onboarding_stage: "candidate" })).toBe(true);
    expect(isCandidate({ onboarding_stage: "documents" })).toBe(false);
    expect(isCandidate({ onboarding_stage: "employee" })).toBe(false);
  });

  it("handles missing rows defensively", () => {
    expect(isCandidate(null)).toBe(false);
    expect(isCandidate(undefined)).toBe(false);
    expect(isCandidate({})).toBe(false);
  });
});

describe("progressPct", () => {
  it("spans 0 → 100 across the six stages", () => {
    expect(progressPct("candidate")).toBe(0);
    expect(progressPct("documents")).toBe(20);
    expect(progressPct("offer_generated")).toBe(40);
    expect(progressPct("offer_accepted")).toBe(60);
    expect(progressPct("login_created")).toBe(80);
    expect(progressPct("employee")).toBe(100);
  });

  it("reports 0 for unknown or missing stages", () => {
    expect(progressPct("mystery")).toBe(0);
    expect(progressPct(null)).toBe(0);
  });
});

describe("exhaustiveness — label, badge and index cover every stage", () => {
  it("has no orphaned stage", () => {
    for (const stage of ONBOARDING_STAGES) {
      expect(stageIndex(stage)).toBeGreaterThanOrEqual(0);
      expect(stageLabel(stage)).not.toBe(stage);
      expect(stageBadge(stage)).toMatch(/bg-/);
    }
  });
});
