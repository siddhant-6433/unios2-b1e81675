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

  it("supports multiple cloud-dialer caller IDs and chooses them round-robin", () => {
    expect(manualCallSource).toContain("normalizePlivoVoiceNumberPool(dialerNumberSecrets)");
    expect(manualCallSource).toContain('Deno.env.get("PLIVO_DIALER_PHONE_NUMBERS")');
    expect(manualCallSource).toContain('Deno.env.get("PLIVO_DIALER_PHONE_NUMBER")');
    expect(manualCallSource).toContain("dialerNumbers.length < 2");
    expect(manualCallSource).toContain("At least two unique PLIVO_DIALER_PHONE_NUMBER(S)");
    expect(manualCallSource).toContain('.from("ai_call_records")');
    expect(manualCallSource).toContain('.eq("call_type", "manual")');
    expect(manualCallSource).toContain('select("from_number")');
    expect(manualCallSource).toContain("chooseNextDialerNumber(dialerNumbers");
    expect(manualCallSource).toContain("from_number: dialerFrom");
  });

  it("passes the selected dialer caller ID into the bridge context and answer URL", () => {
    const bridgeContextBlock = manualCallSource.slice(
      manualCallSource.indexOf("body: JSON.stringify({"),
      manualCallSource.indexOf("}),", manualCallSource.indexOf("body: JSON.stringify({")),
    );
    expect(bridgeContextBlock).toContain("dialerFrom");
    expect(manualCallSource).toContain("caller=${encodeURIComponent(dialerFrom)}");
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
      manualCallSource.indexOf("// Patch the provider request identifier"),
    );

    expect(plivoFailureBlock).toContain('status: "failed"');
    expect(plivoFailureBlock).toContain('disposition: "call_setup_failed"');
    expect(plivoFailureBlock).toContain("completed_at: new Date().toISOString()");
  });

  it("uses Plivo ring_url for counsellor-leg callbacks", () => {
    const plivoPayloadBlock = manualCallSource.slice(
      manualCallSource.indexOf("const plivoPayload = {"),
      manualCallSource.indexOf("let plivoRes: Response"),
    );

    expect(plivoPayloadBlock).toContain("ring_url: stateCallbackUrl");
    expect(plivoPayloadBlock).toContain('ring_method: "POST"');
    expect(plivoPayloadBlock).not.toContain("callback_url");
  });

  it("continues when Plivo accepts without a request id", () => {
    const acceptedPatchBlock = manualCallSource.slice(
      manualCallSource.indexOf("// Patch the provider request identifier"),
      manualCallSource.indexOf("return json({", manualCallSource.indexOf("// Patch the provider request identifier")),
    );

    expect(acceptedPatchBlock).toContain('return only "async api spawned"');
    expect(acceptedPatchBlock).toContain("if (requestUuid) callRecordPatch.plivo_call_uuid = requestUuid");
    expect(acceptedPatchBlock).not.toContain("return await failCallSetup");

    const successResponseBlock = manualCallSource.slice(
      manualCallSource.indexOf("return json({", manualCallSource.indexOf("// Log activity")),
      manualCallSource.indexOf("} catch (err: any)", manualCallSource.indexOf("// Log activity")),
    );
    expect(successResponseBlock).toContain("plivo_request_uuid: requestUuid || null");
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
