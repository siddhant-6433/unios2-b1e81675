// Re-send the "your login is ready" notification to an existing staff user, on
// demand, via WhatsApp + email. Reuses the generic whatsapp-send (staff_welcome
// template) and send-email primitives. Caller must be super_admin OR hold
// hr:employees_edit — the same gate as employee editing.
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) return json({ error: "Missing authorization" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const jwt = authHeader.replace("Bearer ", "");
    const [, payloadB64] = jwt.split(".");
    const callerId: string | undefined = JSON.parse(atob(payloadB64.replace(/-/g, "+").replace(/_/g, "/")))?.sub;
    if (!callerId) return json({ error: "Invalid token" }, 401);

    const admin = createClient(supabaseUrl, serviceRoleKey);

    const { user_id } = await req.json();
    if (!user_id) return json({ error: "user_id is required" }, 400);

    // Authz: super_admin or hr:employees_edit.
    const { data: callerRole } = await admin.rpc("get_user_role", { _user_id: callerId });
    let authorized = callerRole === "super_admin";
    if (!authorized) {
      const { data: canEdit } = await admin.rpc("has_permission", { _user_id: callerId, _perm: "hr:employees_edit" });
      authorized = canEdit === true;
    }
    if (!authorized) return json({ error: "Forbidden" }, 403);

    // Resolve the target's contact + role.
    const { data: prof } = await admin
      .from("profiles")
      .select("display_name, email, phone, campus")
      .eq("user_id", user_id)
      .maybeSingle();
    if (!prof) return json({ error: "User profile not found" }, 404);

    const { data: roleRow } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", user_id)
      .limit(1)
      .maybeSingle();
    const roleLabel = String(roleRow?.role || "Staff").replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
    const name = prof.display_name || prof.email || "Staff";
    const campus = prof.campus || "NIMT Educational Institutions";

    const callFn = (fn: string, body: unknown) =>
      fetch(`${supabaseUrl}/functions/v1/${fn}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${serviceRoleKey}`, apikey: serviceRoleKey, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

    let whatsapp_sent = false;
    let email_sent = false;

    // WhatsApp — the existing Meta-approved staff_welcome template.
    if (prof.phone) {
      try {
        const r = await callFn("whatsapp-send", {
          template_key: "staff_welcome",
          phone: prof.phone,
          params: [name, roleLabel, campus],
        });
        whatsapp_sent = r.ok;
        if (!r.ok) console.error("resend whatsapp failed:", await r.text());
      } catch (e) { console.error("resend whatsapp error:", e); }
    }

    // Email — free-form, tells them to log in via mobile OTP (no password/link needed).
    if (prof.email) {
      try {
        const loginUrl = "https://uni.nimt.ac.in";
        const r = await callFn("send-email", {
          to_email: prof.email,
          custom_subject: "Your NIMT UniOs login is ready",
          custom_body:
            `<p>Hi ${name},</p>` +
            `<p>Your NIMT UniOs account (${roleLabel}) is ready.</p>` +
            `<p>Log in at <a href="${loginUrl}">${loginUrl}</a> using your registered mobile number ` +
            `${prof.phone || ""} — choose WhatsApp OTP and verify the code sent to your phone.</p>` +
            `<p>If you have any trouble signing in, reply to this email or contact HR.</p>`,
        });
        email_sent = r.ok;
        if (!r.ok) console.error("resend email failed:", await r.text());
      } catch (e) { console.error("resend email error:", e); }
    }

    return json({ whatsapp_sent, email_sent });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "Unknown error" }, 500);
  }
});
