import { describe, it, expect } from "vitest";
import { describeWhatsAppError, whatsAppErrorHint } from "@/lib/whatsappErrorText";

describe("describeWhatsAppError", () => {
  it("maps a Meta code embedded in a raw '(#code)' string to the actionable line", () => {
    const detail = describeWhatsAppError("(#132001) Template name does not exist in the translation");
    expect(detail?.code).toBe("132001");
    expect(detail?.text).toMatch(/isn't on the selected number/i);
    // Meta's raw wording is kept for the Copy/debug affordance.
    expect(detail?.raw).toMatch(/does not exist in the translation/);
  });

  it("keeps the raw string when no known code is present", () => {
    const detail = describeWhatsAppError("Some unrecognised failure");
    expect(detail?.code).toBeNull();
    expect(detail?.text).toBe("Some unrecognised failure");
  });

  it("still parses the object/array shapes", () => {
    expect(describeWhatsAppError([{ code: 131026 }])?.text).toMatch(/can't receive WhatsApp/i);
  });
});

describe("whatsAppErrorHint", () => {
  it("suggests another test number for recipient-specific failures", () => {
    expect(whatsAppErrorHint("131026")).toMatch(/different test number/i);
    expect(whatsAppErrorHint("131047")).toMatch(/different test number/i);
    expect(whatsAppErrorHint(131049)).toMatch(/different test number/i);
  });
  it("suggests a retry for a transient media fetch error", () => {
    expect(whatsAppErrorHint("131053")).toMatch(/again/i);
  });
  it("gives config hints for billing/template errors and nothing for unknown", () => {
    expect(whatsAppErrorHint("131042")).toMatch(/billing/i);
    expect(whatsAppErrorHint("132001")).toMatch(/approved/i);
    expect(whatsAppErrorHint(null)).toBeNull();
    expect(whatsAppErrorHint("999999")).toBeNull();
  });
});
