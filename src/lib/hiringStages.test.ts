import { describe, it, expect } from "vitest";
import {
  stageOf, stageCounts, daysInStage, nextStages, STATUS_FOR_STAGE, STAGE_OF,
  ALL_STAGES, FUNNEL_STAGES,
} from "./hiringStages";

describe("stageOf", () => {
  it("folds the finer statuses onto Keka's funnel", () => {
    expect(stageOf("new")).toBe("sourced");
    expect(stageOf("reviewing")).toBe("screening");
    expect(stageOf("shortlisted")).toBe("screening");   // both are Screening
    expect(stageOf("interview")).toBe("interview");
    expect(stageOf("offered")).toBe("preboarding");
    expect(stageOf("hired")).toBe("hired");
    expect(stageOf("rejected")).toBe("archived");
    expect(stageOf("withdrawn")).toBe("archived");      // as is a withdrawal
  });

  it("treats an unknown or missing status as sourced rather than dropping the row", () => {
    expect(stageOf(null)).toBe("sourced");
    expect(stageOf(undefined)).toBe("sourced");
    expect(stageOf("something_else")).toBe("sourced");
  });

  it("maps every status the DB permits", () => {
    // Mirrors the job_applicants_status_check constraint.
    for (const s of ["new","reviewing","shortlisted","interview","offered","rejected","hired","withdrawn"]) {
      expect(STAGE_OF[s as keyof typeof STAGE_OF]).toBeDefined();
    }
  });
});

describe("stageCounts", () => {
  it("includes stages with nothing in them", () => {
    const counts = stageCounts([{ status: "new" }, { status: "new" }]);
    expect(counts.sourced).toBe(2);
    expect(counts.screening).toBe(0);
    expect(Object.keys(counts).sort()).toEqual([...ALL_STAGES].sort());
  });

  it("adds up to the number of candidates, so the funnel cannot lose one", () => {
    const rows = [
      { status: "new" }, { status: "reviewing" }, { status: "shortlisted" },
      { status: "interview" }, { status: "offered" }, { status: "hired" },
      { status: "rejected" }, { status: "withdrawn" }, { status: null },
    ];
    const counts = stageCounts(rows);
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(rows.length);
    expect(counts.screening).toBe(2);
    expect(counts.archived).toBe(2);
  });
});

describe("daysInStage", () => {
  const now = new Date(2026, 7, 14);
  it("counts whole days since the stage last changed", () => {
    expect(daysInStage(new Date(2026, 7, 14).toISOString(), now)).toBe(0);
    expect(daysInStage(new Date(2026, 6, 15).toISOString(), now)).toBe(30);
  });

  it("never goes negative and tolerates junk", () => {
    expect(daysInStage(new Date(2026, 8, 1).toISOString(), now)).toBe(0);
    expect(daysInStage(null, now)).toBeNull();
    expect(daysInStage("not a date", now)).toBeNull();
  });
});

describe("nextStages", () => {
  it("only offers forward moves, plus the two outcomes", () => {
    expect(nextStages("sourced")).toEqual(["screening", "interview", "preboarding", "hired", "archived"]);
    expect(nextStages("interview")).toEqual(["preboarding", "hired", "archived"]);
  });

  it("is a dead end once hired, and reopens an archived candidate at the top", () => {
    expect(nextStages("hired")).toEqual([]);
    expect(nextStages("archived")).toEqual(["sourced"]);
  });
});

describe("STATUS_FOR_STAGE", () => {
  it("round-trips: moving to a stage yields a status that maps back to it", () => {
    for (const stage of ALL_STAGES) {
      expect(stageOf(STATUS_FOR_STAGE[stage])).toBe(stage);
    }
  });

  it("writes a status the DB constraint accepts", () => {
    const allowed = ["new","reviewing","shortlisted","interview","offered","rejected","hired","withdrawn"];
    for (const stage of FUNNEL_STAGES) expect(allowed).toContain(STATUS_FOR_STAGE[stage]);
  });
});
