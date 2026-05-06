/**
 * decide-offer-waiver — super_admin approves or rejects a pending offer waiver.
 *
 * The frontend can also UPDATE offer_waivers directly under RLS, but we route
 * through this edge function so the regenerate-offer-letter side-effect
 * happens atomically, the audit user stamps are always set, and downstream
 * consumers (notifications, fee_ledger sync if added later) hook in here.
 */

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function decodeJwt(token: string): Record<string, any> | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = payload + "=".repeat((4 - (payload.length % 4)) % 4);
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const json = (body: object, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) return json({ error: "Missing authorization" }, 401);

    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : authHeader;
    const claims = decodeJwt(token);
    if (!claims?.sub) return json({ error: "Invalid token" }, 401);
    if (claims.exp && claims.exp < Date.now() / 1000) return json({ error: "Token expired" }, 401);

    const callerId = claims.sub as string;

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceRoleKey);

    const { data: callerRole } = await admin.rpc("get_user_role", { _user_id: callerId });
    if (callerRole !== "super_admin") {
      return json({ error: "Forbidden: super_admin only" }, 403);
    }

    const { waiver_id, decision, rejection_reason } = await req.json();
    if (!waiver_id || typeof waiver_id !== "string") return json({ error: "waiver_id required" }, 400);
    if (decision !== "approved" && decision !== "rejected") {
      return json({ error: "decision must be 'approved' or 'rejected'" }, 400);
    }

    // Fetch the waiver to ensure it's still pending and to get the offer for regeneration.
    const { data: waiver, error: wErr } = await admin
      .from("offer_waivers")
      .select("id, offer_letter_id, status")
      .eq("id", waiver_id)
      .maybeSingle();
    if (wErr || !waiver) return json({ error: wErr?.message || "Waiver not found" }, 404);
    if (waiver.status !== "pending") return json({ error: `Waiver is already ${waiver.status}` }, 409);

    const { data: callerProf } = await admin
      .from("profiles").select("display_name").eq("user_id", callerId).maybeSingle();

    const updates: Record<string, any> = {
      status: decision,
      approved_by: callerId,
      approved_by_name: callerProf?.display_name ?? null,
      approved_at: new Date().toISOString(),
    };
    if (decision === "rejected") updates.rejection_reason = rejection_reason || null;

    const { error: upErr } = await admin
      .from("offer_waivers")
      .update(updates)
      .eq("id", waiver_id);
    if (upErr) return json({ error: upErr.message }, 400);

    // If approved, regenerate the offer-letter PDF so the new waiver line
    // shows up immediately. Fire-and-forget — we don't want to block the
    // response on PDF generation.
    if (decision === "approved" && waiver.offer_letter_id) {
      admin.functions
        .invoke("generate-offer-letter", { body: { offer_letter_id: waiver.offer_letter_id } })
        .catch((e) => console.error("[decide-offer-waiver] regenerate failed:", e));
    }

    return json({ success: true, decision });
  } catch (err: any) {
    console.error("[decide-offer-waiver] Error:", err);
    return json({ error: err.message || "Internal server error" }, 500);
  }
});
