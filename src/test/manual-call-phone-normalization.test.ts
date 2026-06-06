import { describe, expect, it } from "vitest";
import { maskPhoneForLog, normalizePlivoVoiceNumber } from "../../supabase/functions/_shared/phone";

describe("manual-call phone normalization", () => {
  it("normalizes Indian counsellor and lead numbers to Plivo voice E.164 digits", () => {
    expect(normalizePlivoVoiceNumber("+919599682428")).toBe("919599682428");
    expect(normalizePlivoVoiceNumber("9599682428")).toBe("919599682428");
    expect(normalizePlivoVoiceNumber("09599682428")).toBe("919599682428");
    expect(normalizePlivoVoiceNumber("+91 09599 682428")).toBe("919599682428");
  });

  it("rejects numbers that Plivo cannot route as E.164 voice calls", () => {
    expect(normalizePlivoVoiceNumber("682428")).toBeNull();
    expect(normalizePlivoVoiceNumber("000000")).toBeNull();
    expect(normalizePlivoVoiceNumber("")).toBeNull();
  });

  it("masks phone numbers in provider logs", () => {
    expect(maskPhoneForLog("919599682428")).toBe("********2428");
  });
});
