/**
 * Generate Apply Magic Link
 *
 * Counsellor-invoked. Creates a time-bound token that lets a student log into the
 * application portal without OTP. Multi-use within the validity window.
 *
 * Input:  { lead_id: string, expires_in_hours?: number, mode?: string }   (default 168 = 7 days)
 * Output: { url, token, expires_at }
 */

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PORTAL_BASE = Deno.env.get("APPLY_PORTAL_BASE") || "https://uni.nimt.ac.in/apply";

function json(body: any, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const db = createClient(supabaseUrl, serviceRoleKey);

    const auth = req.headers.get("authorization") || "";
    const accessToken = auth.replace(/^Bearer\s+/i, "");
    const { data: { user }, error: authErr } = await db.auth.getUser(accessToken);
    if (authErr || !user) return json({ error: "Unauthorized" }, 401);

    // Confirm caller is staff (anything except student/parent)
    const { data: roles } = await db.from("user_roles").select("role").eq("user_id", user.id);
    const isStaff = (roles || []).some((r: any) => !["student", "parent"].includes(r.role));
    if (!isStaff) return json({ error: "Forbidden" }, 403);
    const callerRole = (roles || []).find((r: any) => r.role === "academic_partner")?.role
      || (roles || [])[0]?.role
      || null;

    const { lead_id, expires_in_hours = 168, mode = "student" } = await req.json();
    if (!lead_id) return json({ error: "lead_id required" }, 400);
    if (!["student", "academic_partner_on_behalf"].includes(mode)) {
      return json({ error: "Unsupported apply link mode" }, 400);
    }

    const hours = Math.max(1, Math.min(720, Number(expires_in_hours) || 168)); // 1h–30d
    const expiresAt = new Date(Date.now() + hours * 3600 * 1000).toISOString();

    const { data: lead, error: leadErr } = await db.from("leads")
      .select("id, name, phone, email, academic_partner_id")
      .eq("id", lead_id)
      .single();
    if (leadErr || !lead) return json({ error: "Lead not found" }, 404);
    if (!lead.phone) return json({ error: "Lead has no phone number" }, 400);

    const { data: profile } = await db.from("profiles").select("id").eq("user_id", user.id).maybeSingle();
    const { data: partner } = await db
      .from("academic_partners")
      .select("id, name")
      .eq("user_id", user.id)
      .maybeSingle();

    if (mode === "academic_partner_on_behalf") {
      if (callerRole !== "academic_partner" || !partner?.id) {
        return json({ error: "Only academic partners can generate on-behalf application links" }, 403);
      }
      const { data: canOpen, error: scopeErr } = await db.rpc("can_academic_partner_view_mapped_lead", {
        _user_id: user.id,
        _lead_id: lead_id,
      });
      if (scopeErr || !canOpen || lead.academic_partner_id !== partner.id) {
        return json({ error: "You can create on-behalf links only for assigned academic partner leads" }, 403);
      }
    }

    const { data: tokenRow, error: insErr } = await db.from("apply_magic_tokens").insert({
      lead_id,
      phone: lead.phone,
      email: lead.email,
      expires_at: expiresAt,
      created_by: profile?.id || null,
      mode,
      actor_user_id: mode === "academic_partner_on_behalf" ? user.id : null,
      actor_role: mode === "academic_partner_on_behalf" ? "academic_partner" : null,
      academic_partner_id: mode === "academic_partner_on_behalf" ? partner?.id : null,
    }).select("token, expires_at").single();
    if (insErr) return json({ error: insErr.message }, 500);

    await db.from("lead_activities").insert({
      lead_id,
      type: "system",
      description: mode === "academic_partner_on_behalf"
        ? `Academic partner on-behalf apply link generated (valid ${hours}h)`
        : `Magic login link generated (valid ${hours}h)`,
    });

    if (mode === "academic_partner_on_behalf") {
      await db.from("application_on_behalf_audit").insert({
        action: "application_on_behalf_link_created",
        lead_id,
        actor_user_id: user.id,
        academic_partner_id: partner?.id || null,
        candidate_phone: lead.phone,
        metadata: { expires_in_hours: hours },
      });
    }

    const url = `${PORTAL_BASE}?token=${tokenRow.token}`;
    return json({ url, token: tokenRow.token, expires_at: tokenRow.expires_at });
  } catch (err: any) {
    console.error("[generate-apply-link]", err);
    return json({ error: err.message }, 500);
  }
});
