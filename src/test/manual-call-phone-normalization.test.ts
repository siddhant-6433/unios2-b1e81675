import { describe, expect, it } from "vitest";
import {
  maskPhoneForLog,
  normalizePlivoVoiceNumber,
  normalizePlivoVoiceNumberPool,
  normalizePlivoVoiceNumbers,
} from "../../supabase/functions/_shared/phone";

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

  it("parses comma or newline separated Plivo dialer caller IDs without splitting formatted numbers", () => {
    expect(normalizePlivoVoiceNumbers("+91 95551 92192, 9599682428\n+91 95551 92192")).toEqual([
      "919555192192",
      "919599682428",
    ]);
  });

  it("normalizes the Bengaluru Plivo dialer landline DIDs", () => {
    expect(normalizePlivoVoiceNumbers("+91 80 6595 2008, +91 80 3538 3731")).toEqual([
      "918065952008",
      "918035383731",
    ]);
  });

  it("combines singular and plural Plivo dialer secrets into one de-duplicated pool", () => {
    expect(normalizePlivoVoiceNumberPool(["+91 95551 92192", "+91 95551 92192, +91 95996 82428"])).toEqual([
      "919555192192",
      "919599682428",
    ]);
  });
});
