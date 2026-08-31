import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const fn = readFileSync("supabase/functions/whatsapp-templates/index.ts", "utf8");
const tab = readFileSync("src/components/templates/WhatsAppTemplateTab.tsx", "utf8");
const form = readFileSync("src/components/templates/WhatsAppTemplateForm.tsx", "utf8");

describe("whatsapp-templates multi-WABA sync", () => {
  it("syncs every connected account, not just WHATSAPP_WABA_ID", () => {
    // Before this, list/sync only ever read the env default, so a template
    // approved under any other WABA could never appear no matter how many
    // times "Sync from Meta" was pressed.
    expect(fn).toContain("resolveWabaTargets");
    expect(fn).toContain('.from("whatsapp_channels")');
    expect(fn).toContain("secret_token_name");
    expect(fn).toContain("collectRowsAcrossWabas");
  });

  it("follows Meta's paging cursor instead of reading one page", () => {
    // Meta orders templates by creation, so a single limit=200 page drops
    // exactly the newest approvals — the reported symptom.
    expect(fn).toContain("data?.paging?.next");
    expect(fn).toContain("page < 25");
  });

  it("keeps default-WABA rows at waba_id NULL", () => {
    // waSenders.normWaba() maps NULL to "MAIN" and the main senders carry no
    // waba_id of their own, so stamping a real id here would make
    // senderCanSendTemplate reject every main-sender template send.
    expect(fn).toContain("target.isDefault ? null : target.wabaId");
    expect(fn).toContain("waba_id: wabaId === defaultWabaId ? null : wabaId");
  });

  it("lets one dead account fail without blocking the healthy ones", () => {
    expect(fn).toContain("perWaba.every((w) => w.error)");
  });

  it("builds the create URL after the WABA override", () => {
    // A URL captured before the override would submit to the default account
    // and silently ignore whichever WABA the submitter picked.
    expect(fn).toContain("templatesUrl(wabaId)");
    expect(fn).not.toContain("const metaUrl =");
  });

  it("never returns a token from the wabas action", () => {
    const wabasAction = fn.slice(fn.indexOf('if (action === "wabas")'));
    const body = wabasAction.slice(0, wabasAction.indexOf("// ── CREATE"));
    expect(body).toContain("waba_id: t.wabaId");
    expect(body).toContain("label:");
    expect(body).not.toContain("token");
  });

  it("wires both pickers to the same source of truth", () => {
    // The sync picker and the submission picker must not drift.
    expect(tab).toContain('action: "wabas"');
    expect(form).toContain('action: "wabas"');
    expect(form).toContain("waba_id: wabaId");
    // Sync-one is opt-in; the default button covers every account.
    expect(tab).toContain("syncFromMeta(w.waba_id)");
    expect(tab).toContain("Sync all WABAs");
  });

  it("surfaces the per-account outcome instead of a single-line toast", () => {
    // A partial failure (one lapsed token) was invisible before.
    expect(tab).toContain("syncReport");
    expect(tab).toContain("per_waba");
  });
});
