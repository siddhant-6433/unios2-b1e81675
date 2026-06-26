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

const ALLOWED_ACTIONS = new Set([
  "application_fee_initiated_by_partner",
  "application_fee_paid_by_partner",
  "token_fee_initiated_by_partner",
  "token_fee_paid_by_partner",
]);

async function validateToken(db: any, token: string) {
  const { data: row, error } = await db
    .from("apply_magic_tokens")
    .select("token, lead_id, phone, expires_at, revoked_at, mode, actor_user_id, academic_partner_id")
    .eq("token", token)
    .maybeSingle();
  if (error || !row) throw new Error("Invalid on-behalf token");
  if (row.mode !== "academic_partner_on_behalf") throw new Error("Token is not valid for academic partner on-behalf actions");
  if (row.revoked_at) throw new Error("This on-behalf link was revoked");
  if (new Date(row.expires_at) < new Date()) throw new Error("This on-behalf link has expired");

  const { data: scoped } = await db.rpc("can_academic_partner_view_mapped_lead", {
    _user_id: row.actor_user_id,
    _lead_id: row.lead_id,
  });
  if (!scoped) throw new Error("This lead is no longer assigned to the academic partner");
  return row;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const db = createClient(supabaseUrl, serviceRoleKey);

    const { token, action, application_id, offer_letter_id, lead_payment_id, payment_ref, metadata = {} } = await req.json();
    if (!token) return json({ error: "token required" }, 400);
    if (!ALLOWED_ACTIONS.has(action)) return json({ error: "unsupported audit action" }, 400);

    const tokenRow = await validateToken(db, token);

    let applicationUuid: string | null = null;
    if (application_id) {
      const { data: app } = await db
        .from("applications")
        .select("id, lead_id")
        .eq("application_id", application_id)
        .maybeSingle();
      if (!app || app.lead_id !== tokenRow.lead_id) return json({ error: "Application is not linked to this assigned lead" }, 403);
      applicationUuid = app.id;
    }

    if (offer_letter_id) {
      const { data: offer } = await db
        .from("offer_letters")
        .select("id, lead_id")
        .eq("id", offer_letter_id)
        .maybeSingle();
      if (!offer || offer.lead_id !== tokenRow.lead_id) return json({ error: "Offer is not linked to this assigned lead" }, 403);
    }

    const { error } = await db.from("application_on_behalf_audit").insert({
      action,
      lead_id: tokenRow.lead_id,
      application_uuid: applicationUuid,
      application_id: application_id || null,
      offer_letter_id: offer_letter_id || null,
      lead_payment_id: lead_payment_id || null,
      payment_ref: payment_ref || null,
      actor_user_id: tokenRow.actor_user_id,
      academic_partner_id: tokenRow.academic_partner_id,
      candidate_phone: tokenRow.phone,
      metadata,
    });
    if (error) return json({ error: error.message }, 400);
    return json({ ok: true });
  } catch (err: any) {
    console.error("[academic-partner-on-behalf-audit]", err);
    return json({ error: err.message || "Unexpected error" }, 500);
  }
});
