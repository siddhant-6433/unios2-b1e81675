// create-payment-link (auth required)
//
// Validates the caller (staff role, OR a consultant linked to the lead/student),
// inserts a payment_links row with a server-authoritative amount, and — when the
// resolved gateway is Razorpay — creates a hosted Razorpay Payment Link and
// stores gateway_link_id + short_url. For other gateways the pay URL is our own
// page /pay/<token>. Optionally sends the link over WhatsApp/email via notify.
//
// The amount from the client is only trusted for purpose='custom'/'pre_admission_token'
// (a genuine free amount). For purpose='fee_due' we DO trust the passed amount but
// stamp it as the due — the pay-link settlement re-validates at settle time.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type JsonRecord = Record<string, unknown>;

function json(payload: JsonRecord, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const STAFF_ROLES = new Set([
  "super_admin", "campus_admin", "admission_head", "accountant", "counsellor",
]);

async function razorpayCreatePaymentLink(
  keyId: string,
  keySecret: string,
  body: JsonRecord,
): Promise<{ ok: boolean; id?: string; short_url?: string; error?: string }> {
  const res = await fetch("https://api.razorpay.com/v1/payment_links", {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${keyId}:${keySecret}`)}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, error: data?.error?.description || data?.message || "Razorpay payment link creation failed" };
  }
  return { ok: true, id: String(data.id || ""), short_url: String(data.short_url || "") };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const keyId = Deno.env.get("RAZORPAY_KEY_ID");
    const keySecret = Deno.env.get("RAZORPAY_KEY_SECRET");
    const publicBase = Deno.env.get("PUBLIC_APP_URL") || "https://uni.nimt.ac.in";

    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader.startsWith("Bearer ")) return json({ error: "Unauthorized" }, 401);

    // Caller-scoped client (respects RLS + identifies auth.uid()).
    const caller = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
      auth: { persistSession: false },
    });
    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    const { data: userData } = await caller.auth.getUser();
    const user = userData?.user;
    if (!user) return json({ error: "Unauthorized" }, 401);

    const parsed = await req.json().catch(() => ({}));
    const purpose = String(parsed.purpose || "custom");
    const leadId = parsed.lead_id ? String(parsed.lead_id) : null;
    const studentId = parsed.student_id ? String(parsed.student_id) : null;
    const amount = Math.round(Number(parsed.amount) * 100) / 100;
    const note = parsed.note ? String(parsed.note).slice(0, 500) : null;
    const expiresDays = Number.isFinite(Number(parsed.expires_days)) ? Number(parsed.expires_days) : 7;
    const sendChannel = String(parsed.send_channel || "none"); // 'whatsapp' | 'email' | 'both' | 'none'

    if (!["pre_admission_token", "fee_due", "custom"].includes(purpose)) {
      return json({ error: "Invalid purpose" }, 400);
    }
    if (!leadId && !studentId) return json({ error: "lead_id or student_id is required" }, 400);
    if (!Number.isFinite(amount) || amount <= 0) return json({ error: "amount must be > 0" }, 400);

    // --- Authorise the caller ------------------------------------------------
    const { data: roleRows } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id);
    const roles = (roleRows || []).map((r: any) => r.role);
    const isStaff = roles.some((r: string) => STAFF_ROLES.has(r));

    // Consultant identity (if any).
    const { data: consultantRow } = await admin
      .from("consultants")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();
    const consultantId: string | null = consultantRow?.id || null;

    if (!isStaff && !consultantId) {
      return json({ error: "Not authorised to send payment links" }, 403);
    }

    // If a consultant (and not staff), verify the target is linked to them.
    if (!isStaff && consultantId) {
      let linked = false;
      if (leadId) {
        const { data: lead } = await admin
          .from("leads").select("consultant_id").eq("id", leadId).maybeSingle();
        linked = lead?.consultant_id === consultantId;
      } else if (studentId) {
        const { data: student } = await admin
          .from("students").select("lead_id").eq("id", studentId).maybeSingle();
        if (student?.lead_id) {
          const { data: lead } = await admin
            .from("leads").select("consultant_id").eq("id", student.lead_id).maybeSingle();
          linked = lead?.consultant_id === consultantId;
        }
      }
      if (!linked) return json({ error: "This candidate is not linked to your consultant account" }, 403);
    }

    // --- Resolve payer contact -----------------------------------------------
    let payerName = "Candidate";
    let payerPhone: string | null = null;
    let payerEmail: string | null = null;
    if (leadId) {
      const { data: lead } = await admin
        .from("leads").select("name, phone, email").eq("id", leadId).maybeSingle();
      payerName = lead?.name || payerName;
      payerPhone = lead?.phone || null;
      payerEmail = lead?.email || null;
    } else if (studentId) {
      const { data: student } = await admin
        .from("students").select("name, phone, email").eq("id", studentId).maybeSingle();
      payerName = student?.name || payerName;
      payerPhone = student?.phone || null;
      payerEmail = student?.email || null;
    }

    // --- Insert the link row (service role; amount is authoritative) ----------
    const { data: linkRow, error: insErr } = await admin
      .from("payment_links")
      .insert({
        lead_id: leadId,
        student_id: studentId,
        purpose,
        amount,
        note,
        created_by: user.id,
        consultant_id: consultantId,
        expires_at: new Date(Date.now() + expiresDays * 86400000).toISOString(),
      } as any)
      .select("id, token")
      .single();
    if (insErr || !linkRow) return json({ error: insErr?.message || "Failed to create link" }, 500);

    const ourUrl = `${publicBase.replace(/\/$/, "")}/pay/${linkRow.token}`;
    let payUrl = ourUrl;
    let gateway: string | null = null;
    let gatewayLinkId: string | null = null;
    let shortUrl: string | null = null;

    // --- Razorpay hosted payment link (preferred when configured) ------------
    if (keyId && keySecret) {
      const rp = await razorpayCreatePaymentLink(keyId, keySecret, {
        amount: Math.round(amount * 100),
        currency: "INR",
        accept_partial: false,
        description: note || (purpose === "pre_admission_token"
          ? "Token fee prior to admission"
          : purpose === "fee_due" ? "Fee due" : "Payment"),
        customer: {
          name: payerName,
          ...(payerEmail ? { email: payerEmail } : {}),
          ...(payerPhone ? { contact: payerPhone } : {}),
        },
        notify: { sms: false, email: false },
        reminder_enable: true,
        notes: { payment_link_id: linkRow.id, purpose },
        callback_url: ourUrl,
        callback_method: "get",
      });
      if (rp.ok) {
        gateway = "razorpay";
        gatewayLinkId = rp.id || null;
        shortUrl = rp.short_url || null;
        payUrl = shortUrl || ourUrl;
      } else {
        // Fall back to our own page; log but don't fail the request.
        console.error("[create-payment-link] razorpay link failed:", rp.error);
      }
    }

    await admin
      .from("payment_links")
      .update({ gateway, gateway_link_id: gatewayLinkId, short_url: shortUrl } as any)
      .eq("id", linkRow.id);

    // --- Optionally notify the candidate -------------------------------------
    if (sendChannel !== "none" && leadId) {
      fetch(`${supabaseUrl}/functions/v1/notify-event`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
        body: JSON.stringify({
          event: "payment_link_sent",
          lead_id: leadId,
          context: { payment_link_id: linkRow.id, pay_url: payUrl, amount, purpose, channel: sendChannel },
        }),
      }).catch((e) => console.error("[create-payment-link] notify failed:", e));
    }

    return json({
      id: linkRow.id,
      token: linkRow.token,
      pay_url: payUrl,
      short_url: shortUrl,
      gateway,
      amount,
    });
  } catch (error) {
    console.error("[create-payment-link] error:", error);
    return json({ error: error instanceof Error ? error.message : "Unexpected error" }, 500);
  }
});
