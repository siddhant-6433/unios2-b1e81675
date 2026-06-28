import { readFileSync } from "fs";
import { describe, expect, it } from "vitest";

const leadPicker = readFileSync("src/components/leads/SendWhatsAppDialog.tsx", "utf8");
const bulkTemplates = readFileSync("src/config/waBulkTemplates.ts", "utf8");
const whatsappSend = readFileSync("supabase/functions/whatsapp-send/index.ts", "utf8");
const campaignSend = readFileSync("supabase/functions/whatsapp-campaign-send/index.ts", "utf8");
const migration = readFileSync(
  "supabase/migrations/20260628190000_enable_cuet_2026_counselling_whatsapp.sql",
  "utf8",
);

describe("CUET 2026 counselling WhatsApp template routing", () => {
  it("is available in the lead picker and list bulk picker", () => {
    expect(leadPicker).toContain('key: "cuet_2026_counselling_open"');
    expect(leadPicker).toContain("header_image_url");
    expect(bulkTemplates).toContain('key: "cuet_2026_counselling_open"');
  });

  it("is accepted by both WhatsApp send functions with an image header", () => {
    expect(whatsappSend).toContain("cuet_2026_counselling_open");
    expect(whatsappSend).toContain('type: "image"');
    expect(campaignSend).toContain("cuet_2026_counselling_open");
    expect(campaignSend).toContain('type: "image"');
  });

  it("seeds lead-picker visibility and allows template asset uploads", () => {
    expect(migration).toContain("'cuet_2026_counselling_open'");
    expect(migration).toContain("show_in_lead_picker = true");
    expect(migration).toContain("'template-assets'");
    expect(migration).toContain("'admission_head'::public.app_role");
  });
});
