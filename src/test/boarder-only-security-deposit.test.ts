import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const edgeFn = readFileSync("supabase/functions/provision-student-fees/index.ts", "utf8");
const migration = readFileSync(
  "supabase/migrations/20260922084349_boarder_only_security_deposit_repair.sql",
  "utf8",
);

describe("boarder-only security deposit", () => {
  it("gates security deposits by code, not the enrollment category", () => {
    // NB-SEC / MR-SEC are tagged category 'enrollment', so the hostel branch
    // never saw them. They must be matched by code and gated to boarders.
    expect(edgeFn).toContain('const SECURITY_DEPOSIT_CODES = ["NB-SEC", "MR-SEC"]');
    expect(edgeFn).toContain("if (isSecurityDeposit(code)) return isBoarder;");
  });

  it("normalises the student_type vocabulary", () => {
    // day_scholar == "Day Scholar"; hostel / boarder / HOSTELER == boarder;
    // "Day Boarder" is separate.
    expect(edgeFn).toContain('["boarder", "hostel", "hosteler"].includes(studentTypeRaw)');
    expect(edgeFn).toContain('studentTypeRaw === "day scholar"');
    expect(edgeFn).toContain('studentTypeRaw === "day boarder"');
  });

  it("repairs non-boarders already billed a boarder-only deposit", () => {
    expect(migration).toContain("NB-SEC");
    expect(migration).toContain("MR-SEC");
    expect(migration).toContain("COALESCE(fl.paid_amount, 0) = 0");
  });
});
