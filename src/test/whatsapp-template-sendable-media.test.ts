import { describe, it, expect } from "vitest";
import {
  resolveSendableTemplateMediaUrl,
  templateMediaUrlFromComponents,
  type WhatsAppTemplateComponent,
} from "@/components/templates/WhatsAppTemplatePreviewBubble";

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
});
