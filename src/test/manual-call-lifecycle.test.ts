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

  it("has a shared terminal failure helper for pre-provider setup failures", () => {
    const failHelperBlock = manualCallSource.slice(
      manualCallSource.indexOf("const failCallSetup = async"),
      manualCallSource.indexOf("// Set bridge context on voice agent server"),
    );

    expect(failHelperBlock).toContain('status: "failed"');
    expect(failHelperBlock).toContain('disposition: "call_setup_failed"');
    expect(failHelperBlock).toContain("completed_at: new Date().toISOString()");
  });

  it("terminally closes the live-call row when setup fails before dialing", () => {
    const contextFailureBlock = manualCallSource.slice(
      manualCallSource.indexOf("if (!ctxRes.ok)"),
      manualCallSource.indexOf("const answerUrl"),
    );

    expect(contextFailureBlock).toContain("return await failCallSetup");
    expect(contextFailureBlock).toContain("bridge context setup failed");
  });

  it("terminally closes the live-call row when bridge context fetch throws", () => {
    const bridgeRequestBlock = manualCallSource.slice(
      manualCallSource.indexOf("let ctxRes: Response"),
      manualCallSource.indexOf("if (!ctxRes.ok)"),
    );

    expect(bridgeRequestBlock).toContain("try {");
    expect(bridgeRequestBlock).toContain("catch (err: any)");
    expect(bridgeRequestBlock).toContain("return await failCallSetup");
    expect(bridgeRequestBlock).toContain("bridge context request failed");
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

  it("terminally closes the live-call row when Plivo accepts without a request id", () => {
    const missingRequestUuidBlock = manualCallSource.slice(
      manualCallSource.indexOf("if (!requestUuid)"),
      manualCallSource.indexOf("// Patch the provider request identifier"),
    );

    expect(missingRequestUuidBlock).toContain("return await failCallSetup");
    expect(missingRequestUuidBlock).toContain("accepted request without request_uuid");
    expect(missingRequestUuidBlock).toContain("did not return a call request id");
  });

  it("terminally closes the live-call row when Plivo fetch throws", () => {
    const plivoRequestBlock = manualCallSource.slice(
      manualCallSource.indexOf("let plivoRes: Response"),
      manualCallSource.indexOf("const plivoText = await plivoRes.text()"),
    );

    expect(plivoRequestBlock).toContain("try {");
    expect(plivoRequestBlock).toContain("catch (err: any)");
    expect(plivoRequestBlock).toContain("return await failCallSetup");
    expect(plivoRequestBlock).toContain("Plivo request failed");
  });
});
