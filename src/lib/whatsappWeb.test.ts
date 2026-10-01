import { describe, expect, it } from "vitest";
import { buildWhatsAppWebUrl, renderWhatsAppWebOnlyTemplate, renderWhatsAppWebTemplate } from "./whatsappWeb";

describe("WhatsApp Web template handoff", () => {
  it("renders a body using resolved parameters and appends a text follow-up", () => {
    expect(renderWhatsAppWebTemplate({
      components: [{ type: "BODY", text: "Hi {{1}}, your course is {{2}}." }],
      params: ["Asha", "B.Sc Nursing"],
      followUpText: "Reply if you have questions.",
    })).toEqual({ ok: true, text: "Hi Asha, your course is B.Sc Nursing.\n\nReply if you have questions." });
  });

  it("rejects media, interactive, and unresolved templates", () => {
    expect(renderWhatsAppWebTemplate({ needsMediaHeader: true, fallbackText: "Hello" }).ok).toBe(false);
    expect(renderWhatsAppWebTemplate({ components: [{ type: "BUTTONS" }, { type: "BODY", text: "Hello" }] }).ok).toBe(false);
    expect(renderWhatsAppWebTemplate({ components: [{ type: "BODY", text: "Hi {{1}}" }] }).ok).toBe(false);
  });

  it("builds a Web chat URL with a country code and encoded message", () => {
    expect(buildWhatsAppWebUrl("98765 43210", "Hello & welcome"))
      .toBe("https://web.whatsapp.com/send?phone=919876543210&text=Hello%20%26%20welcome");
  });

  it("renders a browser-only template with a linked attachment", () => {
    expect(renderWhatsAppWebOnlyTemplate({
      template_key: "fee_structure",
      display_name: "Fee Structure",
      category: "fees",
      body: "Hi {{student_name}}, here are the fees for {{course_name}}.",
      attachment_label: "Fee structure PDF",
      attachment_url: "https://files.example.test/fees.pdf",
    }, { student_name: "Asha", course_name: "B.Sc Nursing" })).toEqual({
      ok: true,
      text: "Hi Asha, here are the fees for B.Sc Nursing.\n\nFee structure PDF: https://files.example.test/fees.pdf",
    });
  });
});
