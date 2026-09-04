import { describe, it, expect } from "vitest";
import { describeWhatsAppError } from "@/lib/whatsappErrorText";

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
