import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const fn = readFileSync("supabase/functions/whatsapp-channel-profiles-sync/index.ts", "utf8");
const identity = readFileSync("src/components/whatsapp/WhatsAppBusinessIdentity.tsx", "utf8");
const senders = readFileSync("src/lib/waSenders.ts", "utf8");
const marketing = readFileSync("src/pages/Marketing.tsx", "utf8");

describe("whatsapp channel connection status", () => {
  it("reads Meta's phone-number status, not just verified_name", () => {
    // Mirai 9220522282 was selectable in Marketing while Meta still returned
    // 133010 (number not registered) because we never stored Cloud API status.
    expect(fn).toContain("status,code_verification_status");
    expect(fn).toContain("connection_status");
    expect(fn).toContain("/phone_numbers?fields=id,display_phone_number,verified_name,status");
  });

  it("discovers school numbers on listed WABAs, including reply-route", () => {
    // Before this, only bulk/admissions routes inherited WHATSAPP_WABA_ID, so
    // Mirai/Beacon (route=reply, waba_id NULL) never synced templates or status.
    expect(fn).toContain("listWabaPhones");
    expect(fn).toContain("discoveredByDigits");
    expect(fn).toContain("listed?.isDefaultWaba || [\"bulk\", \"admissions\"].includes(ch.route)");
  });

  it("does not stamp the default WABA id onto MAIN senders or templates", () => {
    expect(fn).toContain("waba_id: defaultWabaId && wabaId === defaultWabaId ? null : wabaId");
    expect(fn).toContain("wabaId !== defaultWabaId");
  });

  it("lets a template-manager JWT refresh status without waiting for cron", () => {
    expect(fn).toContain("isTemplateManagerCaller");
    expect(fn).toContain("super_admin");
    expect(marketing).toContain("whatsapp-channel-profiles-sync");
  });

  it("shows Connected / Not connected on the sender identity", () => {
    expect(identity).toContain("senderIsConnected");
    expect(identity).toContain("Connected");
    expect(identity).toContain("Not connected");
    expect(senders).toContain("connectionStatus");
    expect(senders).toContain("connection_status");
  });

  it("blocks a Marketing send from a known-disconnected number", () => {
    expect(marketing).toContain("senderIsConnected(waSelectedSender)");
    expect(marketing).toContain("isn't connected on Meta");
  });
});

describe("whatsapp 133010 sender recovery", () => {
  const adapter = readFileSync("supabase/functions/_shared/whatsapp-channel.ts", "utf8");
  const send = readFileSync("supabase/functions/whatsapp-send/index.ts", "utf8");

  it("retries a template send on another token/WABA after Meta 133010", () => {
    // Mirai 9220522282 is stored on WHATSAPP_API_TOKEN with a null waba_id.
    // The first send 133010s; recovery must look past stored WABAs via debug_token.
    expect(adapter).toContain("recoverUnregisteredMetaSender");
    expect(adapter).toContain("WHATSAPP_SERALIS_API_TOKEN");
    expect(adapter).toContain("WHATSAPP_MIRAI_API_TOKEN");
    expect(adapter).toContain("34722980423984295");
    expect(adapter).toContain("wabaIdsForToken");
    expect(adapter.indexOf("errorCode === 133010")).toBeGreaterThan(
      adapter.indexOf("postMetaTemplate"),
    );
  });

  it("sends catalog templates in their stored Meta language, not a hardcoded en", () => {
    expect(send).toContain("templateLanguage");
    expect(send).toContain("language: templateLanguage");
  });
});
