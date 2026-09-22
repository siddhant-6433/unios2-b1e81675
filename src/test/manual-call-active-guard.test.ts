import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const manualCall = readFileSync("supabase/functions/manual-call/index.ts", "utf8");

/**
 * Plivo rings the counsellor's own phone for a bridge call. Without a guard, a
 * duplicated client trigger rings a second call while the first is connected
 * (Plivo reports simultaneous calls). One live bridge call per counsellor.
 */
describe("manual-call one-live-call guard", () => {
  it("rejects a second bridge call while the counsellor already has a live one", () => {
    expect(manualCall).toContain('.eq("caller_user_id", userId)');
    expect(manualCall).toContain('.eq("call_type", "manual")');
    expect(manualCall).toContain('.in("status", ["initiated", "in_progress"])');
    expect(manualCall).toContain("You already have a call in progress");
    expect(manualCall).toContain("409");
  });

  it("bounds the guard window so a stuck row cannot lock the counsellor out", () => {
    expect(manualCall).toMatch(/15 \* 60 \* 1000/);
  });
});
