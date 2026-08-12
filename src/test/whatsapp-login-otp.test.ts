import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const whatsappOtp = readFileSync("supabase/functions/whatsapp-otp/index.ts", "utf8");
const whatsappWebhook = readFileSync("supabase/functions/whatsapp-webhook/index.ts", "utf8");
const otpDiagnosticsMigration = readFileSync("supabase/migrations/20260703121000_whatsapp_otp_delivery_diagnostics.sql", "utf8");

describe("WhatsApp login OTP edge function", () => {
  it("does not require Meta OTP-send secrets before deeplink sign-in actions", () => {
    const startSignInIndex = whatsappOtp.indexOf('if (action === "start_sign_in")');
    const statusSignInIndex = whatsappOtp.indexOf('if (action === "status_sign_in")');
    const sendIndex = whatsappOtp.indexOf('if (action === "send")');
    const sendTokenIndex = whatsappOtp.indexOf('const whatsappToken = Deno.env.get("WHATSAPP_OTP_API_TOKEN")', sendIndex);
    const configErrorIndex = whatsappOtp.indexOf("WhatsApp API not configured", sendIndex);

    expect(startSignInIndex).toBeGreaterThan(-1);
    expect(statusSignInIndex).toBeGreaterThan(startSignInIndex);
    expect(sendIndex).toBeGreaterThan(statusSignInIndex);
    expect(sendTokenIndex).toBeGreaterThan(sendIndex);
    expect(configErrorIndex).toBeGreaterThan(sendTokenIndex);
  });

  it("normalizes typed OTP phone numbers to the same E.164 shape as the login form", () => {
    expect(whatsappOtp).toContain("function normalizeLoginPhone(phone: unknown): string | null");
    expect(whatsappOtp).toContain('if (digits.length === 10) return `+91${digits}`;');
    expect(whatsappOtp).toContain('if (digits.length > 0 && trimmed.startsWith("+")) return `+${digits}`;');
  });

  it("resolves existing auth users through the indexed RPC, not a capped page scan", () => {
    // A single listUsers({ page: 1, perPage: 1000 }) missed ~65% of the ~2,836
    // production users, so returning applicants 500'd with
    // "Failed to provision applicant user".
    expect(whatsappOtp).toContain('admin.rpc("find_auth_user_by_email_or_phone"');
    // The surviving scan is the drift fallback, and it must be paginated —
    // a hardcoded `page: 1` is the bug returning.
    expect(whatsappOtp).toContain("listUsers({ page, perPage: 1000 })");
  });

  it("never resolves the provisioning lookup by phone", () => {
    // The synthetic emails are role-scoped, and one number legitimately fronts
    // several accounts — a phone match would return the student account for an
    // alumni provisioning request.
    expect(whatsappOtp).toContain("_phone: null");
  });

  it("does not demote the service-role client when minting a session", () => {
    // verifyOtp replaces the calling client's auth state; running it on the
    // admin client made the whatsapp_login_intents "consumed" write match 0
    // rows under RLS, leaving the intent replayable.
    expect(whatsappOtp).toContain("authClient.auth.verifyOtp");
    expect(whatsappOtp).not.toContain("admin.auth.verifyOtp(");
    expect(whatsappOtp).toContain('console.error("[whatsapp-otp] intent not marked consumed');
  });

  it("persists Meta message ids and delivery errors for OTP diagnostics", () => {
    expect(otpDiagnosticsMigration).toContain("ADD COLUMN IF NOT EXISTS wa_message_id text");
    expect(otpDiagnosticsMigration).toContain("ADD COLUMN IF NOT EXISTS wa_status_error jsonb");
    expect(otpDiagnosticsMigration).toContain("idx_whatsapp_otps_wa_message_id");

    expect(whatsappOtp).toContain('wa_message_id: wamid || null');
    expect(whatsappOtp).toContain('wa_status: wamid ? "accepted" : "accepted_without_message_id"');
    expect(whatsappOtp).toContain("wa_status_error: parsedWaError || { raw: waBody.slice(0, 1000) }");

    const otpUpdateIndex = whatsappWebhook.indexOf('.from("whatsapp_otps")');
    const messageIdMatchIndex = whatsappWebhook.indexOf('.eq("wa_message_id", waMessageId)', otpUpdateIndex);
    expect(otpUpdateIndex).toBeGreaterThan(-1);
    expect(messageIdMatchIndex).toBeGreaterThan(otpUpdateIndex);
    expect(whatsappWebhook).toContain("wa_status_error: status.errors || null");
  });
});
