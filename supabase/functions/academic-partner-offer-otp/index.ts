import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function generateOtp(): string {
  const array = new Uint32Array(1);
  crypto.getRandomValues(array);
  return String(array[0] % 1000000).padStart(6, "0");
}

async function hashText(value: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(value);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function normalizePhone(p: string): string {
  const digits = p.replace(/\D/g, "");
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return `+${digits}`;
  if (p.startsWith("+")) return p;
  return `+${digits}`;
}

async function validateToken(db: any, token: string, offerLetterId: string, applicationId: string) {
  const { data: row, error } = await db
    .from("apply_magic_tokens")
    .select("token, lead_id, phone, expires_at, revoked_at, mode, actor_user_id, academic_partner_id")
    .eq("token", token)
    .maybeSingle();
  if (error || !row) throw new Error("Invalid on-behalf token");
  if (row.mode !== "academic_partner_on_behalf") throw new Error("Token is not valid for academic partner offer actions");
  if (row.revoked_at) throw new Error("This on-behalf link was revoked");
  if (new Date(row.expires_at) < new Date()) throw new Error("This on-behalf link has expired");

  const { data: scoped } = await db.rpc("can_academic_partner_view_mapped_lead", {
    _user_id: row.actor_user_id,
    _lead_id: row.lead_id,
  });
  if (!scoped) throw new Error("This lead is no longer assigned to the academic partner");

  const { data: offer } = await db
    .from("offer_letters")
    .select("id, lead_id, application_id, approval_status, status")
    .eq("id", offerLetterId)
    .maybeSingle();
  if (!offer || offer.lead_id !== row.lead_id || offer.application_id !== applicationId) {
    throw new Error("Offer is not linked to this assigned lead/application");
  }
  if (offer.approval_status !== "approved") throw new Error("Offer is not approved yet");

  const { data: app } = await db
    .from("applications")
    .select("id, application_id, lead_id")
    .eq("application_id", applicationId)
    .maybeSingle();
  if (!app || app.lead_id !== row.lead_id) throw new Error("Application is not linked to this assigned lead");

  return { tokenRow: row, offer, app };
}

async function audit(db: any, tokenRow: any, action: string, extra: Record<string, unknown> = {}) {
  await db.from("application_on_behalf_audit").insert({
    action,
    lead_id: tokenRow.lead_id,
    actor_user_id: tokenRow.actor_user_id,
    academic_partner_id: tokenRow.academic_partner_id,
    candidate_phone: tokenRow.phone,
    ...extra,
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const whatsappToken = Deno.env.get("WHATSAPP_OTP_API_TOKEN") || Deno.env.get("WHATSAPP_API_TOKEN");
    const phoneNumberId = Deno.env.get("WHATSAPP_OTP_PHONE_NUMBER_ID") || Deno.env.get("WHATSAPP_PHONE_NUMBER_ID");
    const otpTemplateName = Deno.env.get("WHATSAPP_OTP_TEMPLATE") || "unios2_login";
    const db = createClient(supabaseUrl, serviceRoleKey);

    const { token, action, offer_letter_id, application_id, otp } = await req.json();
    if (!token || !offer_letter_id || !application_id) return json({ error: "token, offer_letter_id and application_id are required" }, 400);
    if (!["send", "verify", "check"].includes(action)) return json({ error: "unsupported action" }, 400);

    const { tokenRow, app } = await validateToken(db, token, offer_letter_id, application_id);

    if (action === "check") {
      const { data: consent } = await db
        .from("academic_partner_offer_otps")
        .select("id, verified_at, expires_at")
        .eq("token", token)
        .eq("offer_letter_id", offer_letter_id)
        .gt("expires_at", new Date().toISOString())
        .not("verified_at", "is", null)
        .order("verified_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return json({ verified: Boolean(consent?.verified_at), consent_id: consent?.id || null });
    }

    if (action === "send") {
      if (!whatsappToken || !phoneNumberId) return json({ error: "WhatsApp API not configured. Contact administrator." }, 503);
      const normalizedPhone = normalizePhone(tokenRow.phone);
      const recentCutoff = new Date(Date.now() - 60 * 1000).toISOString();
      const { data: recent } = await db
        .from("academic_partner_offer_otps")
        .select("id")
        .eq("token", token)
        .eq("offer_letter_id", offer_letter_id)
        .is("verified_at", null)
        .gt("created_at", recentCutoff)
        .limit(1);
      if (recent && recent.length > 0) return json({ error: "Please wait 60 seconds before requesting a new OTP." }, 429);

      const otpCode = generateOtp();
      const otpHash = await hashText(otpCode);
      await db.from("academic_partner_offer_otps").insert({
        token,
        lead_id: tokenRow.lead_id,
        application_uuid: app.id,
        application_id,
        offer_letter_id,
        actor_user_id: tokenRow.actor_user_id,
        academic_partner_id: tokenRow.academic_partner_id,
        candidate_phone: normalizedPhone,
        otp_hash: otpHash,
        expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
      });

      const waResponse = await fetch(`https://graph.facebook.com/v21.0/${phoneNumberId}/messages`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${whatsappToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: normalizedPhone.replace(/[^0-9]/g, ""),
          type: "template",
          template: {
            name: otpTemplateName,
            language: { code: "en" },
            components: [
              { type: "body", parameters: [{ type: "text", text: otpCode }] },
              { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: otpCode }] },
            ],
          },
        }),
      });

      const waBody = await waResponse.text();
      if (!waResponse.ok) return json({ error: "Failed to send WhatsApp OTP", detail: waBody }, 502);

      await audit(db, tokenRow, "offer_acceptance_otp_sent", {
        application_uuid: app.id,
        application_id,
        offer_letter_id,
        metadata: { expires_in_minutes: 5 },
      });
      return json({ sent: true });
    }

    if (!otp) return json({ error: "otp required" }, 400);
    const otpHash = await hashText(String(otp));
    const { data: otpRow } = await db
      .from("academic_partner_offer_otps")
      .select("id, otp_hash, expires_at")
      .eq("token", token)
      .eq("offer_letter_id", offer_letter_id)
      .is("verified_at", null)
      .gt("expires_at", new Date().toISOString())
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!otpRow || otpRow.otp_hash !== otpHash) return json({ error: "Invalid or expired OTP" }, 400);
    const verifiedAt = new Date().toISOString();
    await db.from("academic_partner_offer_otps").update({
      verified_at: verifiedAt,
      expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    }).eq("id", otpRow.id);

    await audit(db, tokenRow, "offer_acceptance_otp_verified", {
      application_uuid: app.id,
      application_id,
      offer_letter_id,
      metadata: { consent_valid_minutes: 30, verified_at: verifiedAt },
    });
    return json({ verified: true, consent_id: otpRow.id });
  } catch (err: any) {
    console.error("[academic-partner-offer-otp]", err);
    return json({ error: err.message || "Unexpected error" }, 500);
  }
});
