import { describe, it, expect } from "vitest";
import { filterQueue } from "@/lib/dialerQueue";

const lead = (name: string, phone: string, course_name: string) => ({ name, phone, course_name });

const QUEUE = [
  lead("Aarav Sharma", "9555192192", "B.Sc Nursing"),
  lead("Priya Verma", "9812345678", "MBA"),
  lead("rohit singh", "9999000011", "BPT"),
];

describe("filterQueue", () => {
  it("returns everything for an empty or whitespace search", () => {
    expect(filterQueue(QUEUE, "")).toHaveLength(3);
    expect(filterQueue(QUEUE, "   ")).toHaveLength(3);
  });

  it("matches name case-insensitively", () => {
    expect(filterQueue(QUEUE, "ROHIT").map(l => l.name)).toEqual(["rohit singh"]);
    expect(filterQueue(QUEUE, "sharma").map(l => l.name)).toEqual(["Aarav Sharma"]);
  });

  it("matches a partial phone number", () => {
    expect(filterQueue(QUEUE, "2192").map(l => l.name)).toEqual(["Aarav Sharma"]);
  });

  it("matches course name", () => {
    expect(filterQueue(QUEUE, "nursing").map(l => l.name)).toEqual(["Aarav Sharma"]);
  });

  it("returns an empty list when nothing matches", () => {
    expect(filterQueue(QUEUE, "zzz")).toEqual([]);
  });
});
