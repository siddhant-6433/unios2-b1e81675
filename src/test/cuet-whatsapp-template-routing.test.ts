import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";

const leadPicker = readFileSync("src/components/leads/SendWhatsAppDialog.tsx", "utf8");
const bulkTemplates = readFileSync("src/config/waBulkTemplates.ts", "utf8");
const leadLists = readFileSync("src/pages/LeadLists.tsx", "utf8");
const whatsappSend = readFileSync("supabase/functions/whatsapp-send/index.ts", "utf8");
const campaignSend = readFileSync("supabase/functions/whatsapp-campaign-send/index.ts", "utf8");
const migration = readFileSync(
  "supabase/migrations/20260628190000_enable_cuet_2026_counselling_whatsapp.sql",
  "utf8",
);
const bookingMigration = readFileSync(
  "supabase/migrations/20260629143000_enable_cuet_counselling_booking_whatsapp.sql",
  "utf8",
);
const forceVisibilityMigration = readFileSync(
  "supabase/migrations/20260629190000_force_cuet_whatsapp_template_visibility.sql",
  "utf8",
);

describe("CUET 2026 counselling WhatsApp template routing", () => {
  it("is available in the lead picker and list bulk picker", () => {
    expect(leadPicker).toContain('key: "cuet_2026_counselling_open"');
    expect(leadPicker).toContain('key: "cuet_counselling_booking"');
    expect(leadPicker).toContain("DEFAULT_VISIBLE_WHEN_UNCONFIGURED");
    expect(leadPicker).toContain("show_in_lead_picker !== true");
    expect(leadPicker).toContain("Template Manager → Template Visibility");
    expect(leadPicker).toContain('from("whatsapp_templates")');
    expect(leadPicker).toContain("hasDynamicUrlButton");
    expect(leadPicker).toContain("header_image_url");
    expect(bulkTemplates).toContain('key: "cuet_2026_counselling_open"');
    expect(bulkTemplates).toContain('key: "cuet_counselling_booking"');
  });

  it("uses synced Meta bodies for known CUET template previews", () => {
    expect(leadPicker).toContain("WhatsAppTemplatePreviewBubble");
    expect(leadPicker).toContain("templateTextPreviewFromComponents");
    expect(leadPicker).toContain("metaTemplateOverrides");
    expect(leadPicker).toContain("templateComponentsByKey");
    expect(leadLists).toContain("WhatsAppTemplatePreviewBubble");
    expect(leadLists).toContain("templateTextPreviewFromComponents");
    expect(leadLists).toContain("waMetaTemplateOverrides");
    expect(leadLists).toContain("waTemplateComponentsByKey");
    expect(leadLists).toContain("renderTemplatePreview(waTemplateDef.preview, waStaticParams, waTemplateDef.params)");
  });

  it("is accepted by both WhatsApp send functions with an image header", () => {
    expect(whatsappSend).toContain("cuet_2026_counselling_open");
    expect(whatsappSend).toContain("cuet_counselling_booking");
    expect(whatsappSend).toContain("CUET_COUNSELLING_BOOKING_IMAGE_URL");
    expect(whatsappSend).toContain('cuet_counselling_booking: { name: "cuet_counselling_booking", params: [], headerImageUrl: CUET_COUNSELLING_BOOKING_IMAGE_URL }');
    expect(whatsappSend).toContain("Dynamic WhatsApp template lookup failed");
    expect(whatsappSend).toContain("templateHasDynamicUrlButton");
    expect(whatsappSend).toContain('type: "image"');
    expect(campaignSend).toContain("cuet_2026_counselling_open");
    expect(campaignSend).toContain("cuet_counselling_booking");
    expect(campaignSend).toContain("CUET_COUNSELLING_BOOKING_IMAGE_URL");
    expect(campaignSend).toContain('cuet_counselling_booking: { name: "cuet_counselling_booking", params: [], headerImageUrl: CUET_COUNSELLING_BOOKING_IMAGE_URL }');
    expect(campaignSend).toContain("Dynamic campaign template lookup failed");
    expect(campaignSend).toContain("templateHasDynamicUrlButton");
    expect(campaignSend).toContain('type: "image"');
  });

  it("uses application names and school or college greetings for Dear-style bulk sends", () => {
    expect(campaignSend).toContain("DEAR_STUDENT_NAME_TEMPLATES");
    expect(campaignSend).toContain("resolveLeadDisplayName");
    expect(campaignSend).toContain("resolveDearRecipientName");
    expect(campaignSend).toContain('from("applications")');
    expect(campaignSend).toContain("full_name");
    expect(campaignSend).toContain("lead_institution_type");
    expect(campaignSend).toContain('"Parent"');
    expect(campaignSend).toContain('"Applicant"');
    expect(campaignSend).toContain('"cnet_not_qualified_bpt_bmrit"');
  });

  it("seeds lead-picker visibility and allows template asset uploads", () => {
    expect(migration).toContain("'cuet_2026_counselling_open'");
    expect(migration).toContain("show_in_lead_picker = true");
    expect(migration).toContain("'template-assets'");
    expect(migration).toContain("'admission_head'::public.app_role");
    expect(bookingMigration).toContain("'cuet_counselling_booking'");
    expect(bookingMigration).toContain("1330123838631682");
    expect(bookingMigration).toContain("show_in_lead_picker = true");
    expect(forceVisibilityMigration).toContain("'cuet_2026_counselling_open'");
    expect(forceVisibilityMigration).toContain("'cuet_counselling_booking'");
    expect(forceVisibilityMigration).toContain("show_in_lead_picker = true");
  });
});
