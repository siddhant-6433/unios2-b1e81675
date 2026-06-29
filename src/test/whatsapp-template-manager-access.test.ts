import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const templateFunction = readFileSync("supabase/functions/whatsapp-templates/index.ts", "utf8");
const mediaUploadFunction = readFileSync("supabase/functions/whatsapp-template-media-upload/index.ts", "utf8");
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
});
