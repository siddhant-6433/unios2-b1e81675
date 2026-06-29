import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const templateFunction = readFileSync("supabase/functions/whatsapp-templates/index.ts", "utf8");
const mediaUploadFunction = readFileSync("supabase/functions/whatsapp-template-media-upload/index.ts", "utf8");
const templateManager = readFileSync("src/pages/TemplateManager.tsx", "utf8");
const templateMirrorMigration = readFileSync("supabase/migrations/20260624100800_whatsapp_templates.sql", "utf8");
const serviceRoleGrantMigration = readFileSync(
  "supabase/migrations/20260628183000_grant_service_role_whatsapp_templates.sql",
  "utf8",
);

describe("WhatsApp template manager access", () => {
  it("allows admission heads wherever the template manager backend is exposed", () => {
    expect(templateMirrorMigration).toContain("public.has_role(auth.uid(), 'admission_head'");

    expect(templateFunction).toContain('new Set(["super_admin", "admission_head"])');
    expect(templateFunction).toContain("TEMPLATE_MANAGER_ROLES.has");
    expect(templateFunction).toContain("Forbidden: super_admin or admission_head only");

    expect(mediaUploadFunction).toContain('new Set(["super_admin", "admission_head"])');
    expect(mediaUploadFunction).toContain("TEMPLATE_MANAGER_ROLES.has");
    expect(mediaUploadFunction).toContain("Forbidden: super_admin or admission_head only");
  });

  it("grants service-role writes for template mirror create and sync", () => {
    expect(serviceRoleGrantMigration).toContain(
      "GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_templates TO service_role",
    );
  });

  it("exposes searchable and sortable template visibility controls", () => {
    expect(templateManager).toContain("Template Visibility");
    expect(templateManager).not.toContain("Lead Picker");
    expect(templateManager).toContain('placeholder="Search template name"');
    expect(templateManager).toContain('value="date_added_desc"');
    expect(templateManager).toContain('value="date_used_desc"');
    expect(templateManager).toContain('value="name_asc"');
    expect(templateManager).toContain("last_used_at");
  });

  it("shows approved Meta templates even if their visibility row is missing", () => {
    expect(templateManager).toContain('from("whatsapp_templates")');
    expect(templateManager).toContain('eq("status", "APPROVED")');
    expect(templateManager).toContain("missingApprovedSettings");
    expect(templateManager).toContain("displayNameForWaTemplate");
    expect(templateManager).toContain(".upsert({");
    expect(templateManager).toContain('onConflict: "template_key"');
  });

  it("auto-registers newly approved Meta templates with visibility disabled", () => {
    expect(templateFunction).toContain("registerApprovedTemplateVisibilityRows");
    expect(templateFunction).toContain('show_in_lead_picker: false');
    expect(templateFunction).toContain("visibility_registered");
    expect(templateFunction).toContain("normalizeTemplateStatus(template.status) === \"APPROVED\"");
  });
});
