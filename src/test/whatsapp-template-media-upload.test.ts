import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const form = readFileSync("src/components/templates/WhatsAppTemplateForm.tsx", "utf8");
const tab = readFileSync("src/components/templates/WhatsAppTemplateTab.tsx", "utf8");
const mediaUpload = readFileSync("supabase/functions/whatsapp-template-media-upload/index.ts", "utf8");

describe("WhatsApp template media upload", () => {
  it("uses direct multipart fetch so upload failures expose the function response body", () => {
    expect(form).toContain("async function uploadTemplateMedia(file: File)");
    expect(form).toContain('fetch(`${supabaseUrl}/functions/v1/whatsapp-template-media-upload`');
    expect(form).toContain("readErrorBody(response)");
    expect(form).not.toContain('supabase.functions.invoke("whatsapp-template-media-upload"');
  });

  it("uses the hardened edge wrapper for JSON template management calls", () => {
    expect(form).toContain('invokeEdge<{ error?: string }>("whatsapp-templates"');
    // The sync call's inline generic became the named SyncResponse type once sync
    // started reporting per-WABA results; what matters is that it still routes
    // through invokeEdge rather than raw supabase.functions.invoke.
    expect(tab).toContain('invokeEdge<SyncResponse>("whatsapp-templates"');
    expect(tab).toContain('invokeEdge<{ error?: string }>("whatsapp-templates"');
    expect(form).not.toContain('supabase.functions.invoke("whatsapp-templates"');
    expect(tab).not.toContain('supabase.functions.invoke("whatsapp-templates"');
  });

  it("passes file_name when creating the Meta resumable upload session", () => {
    expect(mediaUpload).toContain("const fileName = file.name");
    expect(mediaUpload).toContain("file_name=${encodeURIComponent(fileName)}");
    expect(mediaUpload).toContain("readMetaResponse(sessionRes)");
    expect(mediaUpload).toContain("readMetaResponse(uploadRes)");
  });
});
