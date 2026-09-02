import { describe, it, expect } from "vitest";
import {
  resolveSendableTemplateMediaUrl,
  templateMediaUrlFromComponents,
  type WhatsAppTemplateComponent,
} from "@/components/templates/WhatsAppTemplatePreviewBubble";
import { classifyHeaderMediaUrl } from "@/lib/publicMediaUrl";
import { interpretWhatsAppMessageStatus } from "@/lib/whatsappTestDelivery";

// Regression: a media-header template whose only example is Meta's scontent
// sample handle used to report a usable "default" media URL. The bulk-send UI
// then hid the required "Header media URL" field and every campaign failed at
// send (whatsapp-campaign-send rejects the scontent handle as a header link).
const scontentImageHeader: WhatsAppTemplateComponent[] = [
  {
    type: "HEADER",
    format: "IMAGE",
    example: { header_handle: ["https://scontent.whatsapp.net/v/t61.29466-34/670896455.jpg?ccb=1-7"] },
  },
  { type: "BODY", text: "Hi {{1}}" },
];

const publicImageHeader: WhatsAppTemplateComponent[] = [
  {
    type: "HEADER",
    format: "IMAGE",
    example: { header_handle: ["https://cdn.example.com/public/header.jpg"] },
  },
];

describe("resolveSendableTemplateMediaUrl", () => {
  it("rejects the scontent sample handle so the UI shows the required media field", () => {
    // still viewable in the preview bubble…
    expect(templateMediaUrlFromComponents(null, scontentImageHeader)).toMatch(/scontent/);
    // …but never counts as a usable campaign send default.
    expect(resolveSendableTemplateMediaUrl(null, scontentImageHeader)).toBeNull();
    expect(resolveSendableTemplateMediaUrl(null, [...scontentImageHeader.slice(0, 1), { type: "BODY", text: "x" }]))
      .toBeNull();
  });

  it("keeps a genuine public header URL as the send default", () => {
    expect(resolveSendableTemplateMediaUrl(null, publicImageHeader)).toBe(
      "https://cdn.example.com/public/header.jpg",
    );
  });

  it("returns null when there is no media header", () => {
    expect(resolveSendableTemplateMediaUrl(null, [{ type: "BODY", text: "Hi" }])).toBeNull();
  });

  it("prefers a Template Manager media_url over Meta's sample handle", () => {
    expect(resolveSendableTemplateMediaUrl(
      "bba_bca_admissions_2026",
      scontentImageHeader,
      "https://cdn.example.com/bba-header.jpg",
    )).toBe("https://cdn.example.com/bba-header.jpg");
  });

  it("rejects a stored scontent URL so the campaign field stays required", () => {
    expect(resolveSendableTemplateMediaUrl(
      null,
      scontentImageHeader,
      "https://scontent.whatsapp.net/v/t61.29466-34/sample.jpg",
    )).toBeNull();
  });
});

describe("classifyHeaderMediaUrl", () => {
  it("rejects empty, http, and Meta sample handles", () => {
    expect(classifyHeaderMediaUrl("").ok).toBe(false);
    expect(classifyHeaderMediaUrl("http://cdn.example.com/a.jpg").reason).toMatch(/https/i);
    expect(classifyHeaderMediaUrl("https://scontent.whatsapp.net/v/x.jpg").ok).toBe(false);
  });

  it("accepts a public https URL", () => {
    expect(classifyHeaderMediaUrl("https://cdn.example.com/header.jpg")).toMatchObject({
      ok: true,
      url: "https://cdn.example.com/header.jpg",
    });
  });
});

describe("interpretWhatsAppMessageStatus", () => {
  it("treats delivered and read as success, failed as a hard stop", () => {
    expect(interpretWhatsAppMessageStatus({ status: "sent", status_error: null, read_at: null })).toBe("pending");
    expect(interpretWhatsAppMessageStatus({ status: "delivered", status_error: null, read_at: null })).toEqual({ status: "delivered" });
    expect(interpretWhatsAppMessageStatus({ status: "read", status_error: null, read_at: "2026-09-02T00:00:00Z" })).toEqual({ status: "read" });
    expect(interpretWhatsAppMessageStatus({ status: "failed", status_error: [{ code: 131026, message: "not on whatsapp" }], read_at: null }).status).toBe("failed");
  });
});
