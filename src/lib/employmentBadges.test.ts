import { describe, it, expect } from "vitest";
import {
  employmentBadges, needsAction, isPunchedIn, daysUntil,
  type BadgeInput, type ExitRecord,
} from "./employmentBadges";

const TODAY = new Date(2026, 7, 15); // 15 Aug 2026

const exit = (status: string, lwd: string | null = "2026-09-30"): ExitRecord => ({
  status, last_working_day: lwd,
});
const kinds = (input: BadgeInput) => employmentBadges(input, TODAY).map((b) => b.kind);

describe("employment state", () => {
  it("shows nothing for an ordinary employee", () => {
    expect(kinds({})).toEqual([]);
    expect(kinds({ employmentStatus: "Working" })).toEqual([]);
  });

  it("surfaces an exit that nobody has acted on yet", () => {
    // The state the real record was stuck in, visible nowhere before this.
    expect(kinds({ exit: exit("under_review") })).toEqual(["exit_requested"]);
  });

  it("shows notice with the date and the days remaining", () => {
    const [badge] = employmentBadges({ exit: exit("in_progress", "2026-09-30") }, TODAY);
    expect(badge.kind).toBe("under_notice");
    // en-IN abbreviates September as "Sept", not "Sep".
    expect(badge.detail).toBe("until 30 Sept · 46 days left");
  });

  it("does not count days once the last working day has passed", () => {
    const [badge] = employmentBadges({ exit: exit("in_progress", "2026-08-01") }, TODAY);
    expect(badge.detail).toBe("until 1 Aug");
  });

  it("shows exited once the exit is completed", () => {
    const [badge] = employmentBadges({ exit: exit("completed", "2026-08-10") }, TODAY);
    expect(badge.kind).toBe("exited");
    expect(badge.detail).toBe("left 10 Aug");
  });

  it("treats a reverted or rejected exit as no exit at all", () => {
    expect(kinds({ exit: exit("reverted") })).toEqual([]);
    expect(kinds({ exit: exit("rejected") })).toEqual([]);
  });

  it("never shows two employment states at once", () => {
    // A completed exit must not also read as requested.
    for (const status of ["under_review", "in_progress", "completed"]) {
      const employment = employmentBadges({ exit: exit(status) }, TODAY)
        .filter((b) => b.kind !== "in" && b.kind !== "out");
      expect(employment).toHaveLength(1);
    }
  });
});

describe("fallback for imported rows", () => {
  // 91 of 99 employees have a NULL employment_status and no exit record, so these
  // paths only cover the handful that were imported with one.
  it("reads employment_status when there is no exit record", () => {
    expect(kinds({ employmentStatus: "On Notice" })).toEqual(["under_notice"]);
    expect(kinds({ employmentStatus: "Resigned" })).toEqual(["exited"]);
    expect(kinds({ employmentStatus: "Terminated" })).toEqual(["exited"]);
  });

  it("lets the exit record win over a stale employment_status", () => {
    // The Job tab dropdown can be hand-edited; the record is authoritative.
    expect(kinds({ exit: exit("in_progress"), employmentStatus: "Resigned" })).toEqual(["under_notice"]);
  });

  it("falls back to date_of_exit when that is all there is", () => {
    expect(kinds({ dateOfExit: "2026-08-10" })).toEqual(["exited"]);
    // A future-dated exit has not happened yet.
    expect(kinds({ dateOfExit: "2026-12-01" })).toEqual([]);
  });
});

describe("attendance", () => {
  const inNow = [{ punch_in: "2026-08-15T09:00:00Z", punch_out: null }];
  const done = [{ punch_in: "2026-08-15T09:00:00Z", punch_out: "2026-08-15T17:00:00Z" }];

  it("is In only while a punch is open", () => {
    expect(isPunchedIn(inNow)).toBe(true);
    expect(isPunchedIn(done)).toBe(false);
    expect(isPunchedIn([])).toBe(false);
    expect(isPunchedIn(undefined)).toBe(false);
  });

  it("is hidden unless asked for", () => {
    expect(kinds({ punchesToday: inNow })).toEqual([]);
    expect(kinds({ punchesToday: inNow, showAttendance: true })).toEqual(["in"]);
  });

  it("still shows for somebody serving notice — they are at work", () => {
    expect(kinds({ exit: exit("in_progress"), punchesToday: inNow, showAttendance: true }))
      .toEqual(["under_notice", "in"]);
  });

  it("is suppressed once they have left", () => {
    expect(kinds({ exit: exit("completed"), punchesToday: done, showAttendance: true }))
      .toEqual(["exited"]);
  });
});

describe("needsAction", () => {
  it("flags an exit waiting on approval", () => {
    expect(needsAction(exit("under_review"), TODAY)).toBe(true);
  });

  it("flags notice that has run out", () => {
    expect(needsAction(exit("in_progress", "2026-08-15"), TODAY)).toBe(true);  // today
    expect(needsAction(exit("in_progress", "2026-08-01"), TODAY)).toBe(true);  // overdue
    expect(needsAction(exit("in_progress", "2026-09-30"), TODAY)).toBe(false); // still serving
  });

  it("ignores anything already settled", () => {
    expect(needsAction(exit("completed"), TODAY)).toBe(false);
    expect(needsAction(exit("reverted"), TODAY)).toBe(false);
    expect(needsAction(null, TODAY)).toBe(false);
  });
});

describe("daysUntil", () => {
  it("counts forwards and backwards, and tolerates junk", () => {
    expect(daysUntil("2026-08-15", TODAY)).toBe(0);
    expect(daysUntil("2026-08-20", TODAY)).toBe(5);
    expect(daysUntil("2026-08-10", TODAY)).toBe(-5);
    expect(daysUntil(null, TODAY)).toBeNull();
    expect(daysUntil("rubbish", TODAY)).toBeNull();
  });
});
