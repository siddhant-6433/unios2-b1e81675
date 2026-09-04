import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import {
  resolveSendableTemplateMediaUrl,
  templateMediaUrlFromComponents,
  type WhatsAppTemplateComponent,
} from "@/components/templates/WhatsAppTemplatePreviewBubble";
import { classifyHeaderMediaUrl } from "@/lib/publicMediaUrl";
import { interpretWhatsAppMessageStatus } from "@/lib/whatsappTestDelivery";
import {
  headerMediaIsSendable,
  headerMediaSendFields,
  nextHeaderMediaParams,
} from "@/lib/headerMediaPrefill";
import { ensureMediaHeaderParam } from "@/config/waBulkTemplates";

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

describe("header media prefill and send payload", () => {
  it("fills a blank field when the Template Manager URL loads after the template pick", () => {
    const first = nextHeaderMediaParams({}, "", "img_tpl", "", "");
    const later = nextHeaderMediaParams(first.params, "https://cdn.example.com/header.jpg", "img_tpl", first.lastAutoKey, first.lastAutoUrl);
    expect(later.params.template_header_media_url).toBe("https://cdn.example.com/header.jpg");
  });

  it("keeps a typed override and does not blank a filled URL when the default disappears", () => {
    const filled = nextHeaderMediaParams({}, "https://cdn.example.com/a.jpg", "img_tpl", "", "");
    const typed = nextHeaderMediaParams(
      { ...filled.params, template_header_media_url: "https://cdn.example.com/custom.jpg" },
      "https://cdn.example.com/a.jpg",
      "img_tpl",
      filled.lastAutoKey,
      filled.lastAutoUrl,
    );
    expect(typed.params.template_header_media_url).toBe("https://cdn.example.com/custom.jpg");
    const dropped = nextHeaderMediaParams(typed.params, "", "img_tpl", typed.lastAutoKey, typed.lastAutoUrl);
    expect(dropped.params.template_header_media_url).toBe("https://cdn.example.com/custom.jpg");
  });

  it("treats a saved default as sendable even when the input is still blank", () => {
    expect(headerMediaIsSendable("", "https://cdn.example.com/header.jpg")).toBe(true);
    expect(headerMediaIsSendable("", "")).toBe(false);
  });

  it("sends document and video headers on the matching Meta field", () => {
    expect(headerMediaSendFields("DOCUMENT", "https://cdn.example.com/a.pdf")).toEqual({
      header_document_url: "https://cdn.example.com/a.pdf",
    });
    expect(headerMediaSendFields("VIDEO", "https://cdn.example.com/a.mp4")).toEqual({
      header_video_url: "https://cdn.example.com/a.mp4",
    });
    expect(headerMediaSendFields("IMAGE", "https://cdn.example.com/a.jpg")).toEqual({
      header_image_url: "https://cdn.example.com/a.jpg",
    });
  });

  it("puts the header file slot back when param_specs omitted it", () => {
    const params = ensureMediaHeaderParam(
      [{ name: "template_value_1", source: "static" }],
      [{ type: "HEADER", format: "IMAGE" }],
    );
    expect(params[0].name).toBe("template_header_media_url");
  });
});

describe("Marketing Hub test send", () => {
  const marketingPage = readFileSync("src/pages/Marketing.tsx", "utf8");

  it("prefills the header URL and does not lock Send test on the live probe or waiting phase", () => {
    expect(marketingPage).toContain("nextHeaderMediaParams");
    expect(marketingPage).toContain("headerMediaIsSendable");
    expect(marketingPage).toContain("headerMediaSendFields");
    expect(marketingPage).not.toContain("waTestSending || waTestPhase === \"waiting\"");
    expect(marketingPage).not.toContain("mediaProbe.status !== \"ok\"");
    expect(marketingPage).toContain("I received it");
    expect(marketingPage).toContain("testSendSignature");
  });
});
