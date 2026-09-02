import { describe, expect, it } from "vitest";
import { describeWhatsAppError, whatsAppErrorText,
  whatsAppErrorTextForCode,
} from "./whatsappErrorText";

describe("describeWhatsAppError", () => {
  it("reads Meta's webhook array shape", () => {
    // whatsapp-webhook writes status.errors verbatim — an array. The inbox used
    // to read only object shapes, so these rendered with no reason at all.
    const detail = describeWhatsAppError([
      { code: 131049, title: "This message was not delivered to maintain healthy ecosystem engagement." },
    ]);
    expect(detail?.code).toBe("131049");
    expect(detail?.text).toMatch(/capped marketing messages/i);
    expect(detail?.ourFault).toBe(false);
  });

  it("reads the whatsapp-send { error: {...} } shape", () => {
    const detail = describeWhatsAppError({
      http_status: 400,
      error: { code: 132000, message: "(#132000) Number of parameters does not match the expected number of params" },
    });
    expect(detail?.code).toBe("132000");
    expect(detail?.ourFault).toBe(true);
    expect(detail?.raw).toMatch(/132000/);
  });

  it("reads legacy flat shapes", () => {
    expect(whatsAppErrorText({ meta_error: "boom" })).toBe("boom");
    expect(whatsAppErrorText({ message: "boom" })).toBe("boom");
  });

  it("falls back to the raw provider message for unknown codes", () => {
    const detail = describeWhatsAppError({ error: { code: 999999, message: "brand new failure" } });
    expect(detail?.text).toBe("brand new failure");
    expect(detail?.ourFault).toBe(false);
  });

  it("returns null when there is nothing to show", () => {
    expect(describeWhatsAppError(null)).toBeNull();
    expect(describeWhatsAppError({})).toBeNull();
    expect(describeWhatsAppError([])).toBeNull();
  });

  it("labels AI dispatch failures as ours", () => {
    const detail = describeWhatsAppError({
      error: { code: "ai_reply_failed", message: "AI generation failed (403)" },
    });
    expect(detail?.ourFault).toBe(true);
    expect(detail?.text).toMatch(/auto-reply/i);
  });
});

describe("campaign failure breakdown wording", () => {
  // Regression: the campaigns table rendered a wall of raw Meta JSON because the
  // caller re-serialised an already-known code into Meta's array shape and fed it
  // back in as a *string*. describeWhatsAppError only handled parsed values, so
  // it fell through to the raw branch and echoed the blob into the table cell.
  it("resolves a known code without a serialisation round-trip", () => {
    expect(whatsAppErrorTextForCode("131049")).toContain("capped marketing messages");
    expect(whatsAppErrorTextForCode(131042)).toContain("billing isn't set up");
    expect(whatsAppErrorTextForCode("131026")).toContain("can't receive WhatsApp");
  });

  it("degrades sanely for unknown or missing codes", () => {
    expect(whatsAppErrorTextForCode("999999")).toBe("WhatsApp error 999999");
    expect(whatsAppErrorTextForCode(null)).toBe("Unknown error");
    expect(whatsAppErrorTextForCode("unknown")).toBe("Unknown error");
  });

  it("parses a JSON string, not only a parsed object", () => {
    // whatsapp_campaign_recipients.error_message stores Meta's array as text.
    const raw = '[{"code": 131049, "title": "This message was not delivered to maintain healthy ecosystem engagement."}]';
    const described = describeWhatsAppError(raw);
    expect(described?.code).toBe("131049");
    expect(described?.text).toContain("capped marketing messages");
    expect(described?.text).not.toContain('{"code"');
  });

  it("still handles a plain non-JSON string", () => {
    expect(describeWhatsAppError("something went wrong")?.text).toBe("something went wrong");
  });
});
