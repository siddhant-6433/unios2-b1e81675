import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const manualCallSource = readFileSync("supabase/functions/manual-call/index.ts", "utf8");

describe("manual-call lifecycle ordering", () => {
  it("creates the live-call record before placing the Plivo call", () => {
    expect(manualCallSource.indexOf('.from("ai_call_records").insert')).toBeGreaterThan(-1);
    expect(manualCallSource.indexOf('.from("ai_call_records").insert')).toBeLessThan(
      manualCallSource.indexOf("fetch(plivoUrl"),
    );
  });

  it("terminally closes the live-call row when setup fails before dialing", () => {
    const contextFailureBlock = manualCallSource.slice(
      manualCallSource.indexOf("if (!ctxRes.ok)"),
      manualCallSource.indexOf("const answerUrl"),
    );

    expect(contextFailureBlock).toContain('status: "failed"');
    expect(contextFailureBlock).toContain('disposition: "call_setup_failed"');
    expect(contextFailureBlock).toContain("completed_at: new Date().toISOString()");
  });

  it("terminally closes the live-call row when Plivo rejects the call", () => {
    const plivoFailureBlock = manualCallSource.slice(
      manualCallSource.indexOf("if (!plivoRes.ok)"),
      manualCallSource.indexOf("// Patch any provider identifier"),
    );

    expect(plivoFailureBlock).toContain('status: "failed"');
    expect(plivoFailureBlock).toContain('disposition: "call_setup_failed"');
    expect(plivoFailureBlock).toContain("completed_at: new Date().toISOString()");
  });
});
