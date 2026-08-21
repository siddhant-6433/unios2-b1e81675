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

async function sha512(message: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest("SHA-512", msgBuffer);
  return Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Optional Easebuzz EasyCollect Create Link API.
 * Hash: key|merchant_txn|name|email|phone|amount|udf1|udf2|udf3|udf4|udf5|message|salt
 * Only used when EASEBUZZ_EASYCOLLECT_URL is set (merchant-enabled product).
 */
async function easebuzzEasyCollectCreateLink(opts: {
  merchantTxn: string;
  name: string;
  email: string;
  phone: string;
  amount: number;
  message: string;
  udf1?: string;
}): Promise<{ ok: boolean; id?: string; short_url?: string; error?: string }> {
  const key = Deno.env.get("EASEBUZZ_KEY") || Deno.env.get("EASEBUZZ_MERCHANT_KEY") || "";
  const salt = Deno.env.get("EASEBUZZ_SALT") || Deno.env.get("EASEBUZZ_MERCHANT_SALT") || "";
  const endpoint = Deno.env.get("EASEBUZZ_EASYCOLLECT_URL") || "";
  if (!key || !salt || !endpoint) {
    return { ok: false, error: "EasyCollect not configured (set EASEBUZZ_EASYCOLLECT_URL)" };
  }
  const amountStr = Number(opts.amount).toFixed(2);
  const email = opts.email || "noreply@nimteducation.com";
  const phone = opts.phone.replace(/\D/g, "").slice(-10) || "9999999999";
  const udf1 = opts.udf1 || "";
  const message = (opts.message || "Payment").slice(0, 200);
  const hashInput = [key, opts.merchantTxn, opts.name, email, phone, amountStr, udf1, "", "", "", "", message, salt].join("|");
  const hash = await sha512(hashInput);
  const body = new URLSearchParams({
    key,
    merchant_txn: opts.merchantTxn,
    name: opts.name,
    email,
    phone,
    amount: amountStr,
    udf1,
    udf2: "",
    udf3: "payment_link",
    udf4: "",
    udf5: "",
    message,
    hash,
  });
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    const data = await res.json().catch(() => ({}));
    // Response shapes vary by account; accept common fields.
    const link = data?.data?.payment_url || data?.data?.link || data?.payment_url || data?.link || data?.data;
    const id = data?.data?.id || data?.data?.merchant_txn || data?.id || opts.merchantTxn;
    if (!res.ok || data?.status === 0 || data?.status === false) {
      return { ok: false, error: data?.error_desc || data?.message || JSON.stringify(data).slice(0, 200) };
    }
    if (typeof link === "string" && link.startsWith("http")) {
      return { ok: true, id: String(id), short_url: link };
    }
    return { ok: false, error: "EasyCollect response missing payment URL" };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "EasyCollect request failed" };
  }
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
    // Optional per-head breakup [{fee_code_id, amount, label}]. Applied to the
    // student's matching fee_ledger heads at settlement/admission by
    // provision_student_fees.
    const rawAllocations = Array.isArray(parsed.allocations) ? parsed.allocations : null;
    const isUuid = (v: unknown) => /^[0-9a-f-]{36}$/i.test(String(v || ""));
    let allocations:
      { fee_code_id: string; fee_ledger_id?: string; amount: number; label?: string }[] | null =
      rawAllocations && rawAllocations.length
        ? rawAllocations.map((a: any) => ({
            fee_code_id: String(a.fee_code_id || ""),
            // Carried through so a link raised against one specific ledger row
            // settles that row. Dropping it here silently turned "pay this
            // quarter's meal charge" into "pay the earliest unpaid meal charge".
            ...(isUuid(a.fee_ledger_id) ? { fee_ledger_id: String(a.fee_ledger_id) } : {}),
            amount: Math.round(Number(a.amount) * 100) / 100,
            label: a.label ? String(a.label).slice(0, 120) : undefined,
          }))
        : null;
    const expiresDays = Number.isFinite(Number(parsed.expires_days)) ? Number(parsed.expires_days) : 7;
    // Live fee_due link: pay-link recomputes base + late fine from the ledger at
    // pay-time. `amount` here is only a send-time snapshot for display/audit.
    const liveFee = parsed.live_fee === true;
    const feeTerm = parsed.fee_term ? String(parsed.fee_term) : null;
    const feeCampaignId = isUuid(parsed.fee_campaign_id) ? String(parsed.fee_campaign_id) : null;
    const sendChannel = String(parsed.send_channel || "none"); // 'whatsapp' | 'email' | 'both' | 'none'
    const wantsWhatsApp = sendChannel === "whatsapp" || sendChannel === "both";
    const wantsEmail = sendChannel === "email" || sendChannel === "both";
    // gateway: 'razorpay' | 'easebuzz' | 'auto' (default)
    // auto = Razorpay hosted link if keys exist, else Easebuzz on /pay/<token>
    //
    // We still mint the hosted Razorpay Payment Link: it is what drives
    // Razorpay's own SMS/email reminders and the payment-link webhook that
    // settles the receipt. What changed is that its rzp.io short_url is no
    // longer handed to anyone — every channel gets our branded /pay/<token>,
    // and that page forwards to the hosted checkout when the payer clicks
    // Pay. One artifact, one settlement path, our branding on the way in.
    //
    // gateway='choice' skips both hosted links: gateway/short_url stay null and
    // the public /pay/<token> page shows a gateway picker. That is the cheap
    // path — Razorpay's hosted link locks the payer into Razorpay's MDR.
    // Live links must not mint a hosted gateway link (that bakes a fixed amount);
    // the amount is resolved at pay-time on the branded /pay page, so treat them
    // like a payer-choice link — no hosted short_url.
    const gatewayPref: string = liveFee ? "choice" : String(parsed.gateway || "auto").toLowerCase();
    const payerChoice = gatewayPref === "choice";

    if (!["pre_admission_token", "fee_due", "custom"].includes(purpose)) {
      return json({ error: "Invalid purpose" }, 400);
    }
    if (!leadId && !studentId) return json({ error: "lead_id or student_id is required" }, 400);
    if (!Number.isFinite(amount) || amount <= 0) return json({ error: "amount must be > 0" }, 400);
    // A live link is billed off the student's ledger at pay-time, so it needs an
    // admitted student and a term to bill.
    if (liveFee && (!studentId || !feeTerm)) {
      return json({ error: "live_fee links require student_id and fee_term" }, 400);
    }

    // Validate the breakup (trust boundary): positive amounts, known fee heads,
    // and total == amount.
    if (allocations) {
      if (allocations.some((a) => !a.fee_code_id || !Number.isFinite(a.amount) || a.amount <= 0)) {
        return json({ error: "Each fee head needs a positive amount" }, 400);
      }
      const sum = Math.round(allocations.reduce((s, a) => s + a.amount, 0) * 100) / 100;
      if (Math.abs(sum - amount) > 0.01) {
        return json({ error: `Breakup total (₹${sum}) must equal the amount (₹${amount})` }, 400);
      }
      const ids = [...new Set(allocations.map((a) => a.fee_code_id))];
      const { data: codes } = await admin.from("fee_codes").select("id").in("id", ids);
      if (!codes || codes.length !== ids.length) {
        return json({ error: "Unknown fee head in the breakup" }, 400);
      }

      // A named ledger row must belong to this payer and match the head it is
      // filed under — otherwise a crafted request could credit someone else's
      // ledger, or the wrong head on this one.
      const ledgerIds = [...new Set(
        allocations.map((a) => a.fee_ledger_id).filter((v): v is string => !!v),
      )];
      if (ledgerIds.length) {
        let ownerId = studentId;
        if (!ownerId && leadId) {
          const { data: s } = await admin.from("students").select("id").eq("lead_id", leadId).maybeSingle();
          ownerId = s?.id || null;
        }
        if (!ownerId) {
          return json({ error: "A fee-row breakup needs an admitted student" }, 400);
        }
        const { data: rows } = await admin
          .from("fee_ledger").select("id, fee_code_id")
          .eq("student_id", ownerId).in("id", ledgerIds);
        if (!rows || rows.length !== ledgerIds.length) {
          return json({ error: "A fee row in the breakup does not belong to this student" }, 400);
        }
        const codeByRow = new Map(rows.map((r: any) => [r.id, r.fee_code_id]));
        if (allocations.some((a) => a.fee_ledger_id && codeByRow.get(a.fee_ledger_id) !== a.fee_code_id)) {
          return json({ error: "A fee row in the breakup does not match its fee head" }, 400);
        }
      }
    }

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

    // Academic partner identity (if any). Partners send payment links from their
    // portal, scoped to leads/students attributed to them.
    const { data: partnerRow } = await admin
      .from("academic_partners")
      .select("id")
      .eq("user_id", user.id)
      .maybeSingle();
    const academicPartnerId: string | null = partnerRow?.id || null;

    if (!isStaff && !consultantId && !academicPartnerId) {
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

    // If an academic partner (and not staff), verify the target is attributed to
    // their partner account.
    if (!isStaff && !consultantId && academicPartnerId) {
      let linked = false;
      if (leadId) {
        const { data: lead } = await admin
          .from("leads").select("academic_partner_id").eq("id", leadId).maybeSingle();
        linked = lead?.academic_partner_id === academicPartnerId;
      } else if (studentId) {
        const { data: student } = await admin
          .from("students").select("lead_id").eq("id", studentId).maybeSingle();
        if (student?.lead_id) {
          const { data: lead } = await admin
            .from("leads").select("academic_partner_id").eq("id", student.lead_id).maybeSingle();
          linked = lead?.academic_partner_id === academicPartnerId;
        }
      }
      if (!linked) return json({ error: "This candidate is not attributed to your academic partner account" }, 403);
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

    // Candidate-facing note carries the breakup so they see what they're paying for.
    let effectiveNote = note;
    if (allocations) {
      const breakup = allocations.map((a) => `${a.label || "Fee"}: ₹${a.amount}`).join(", ");
      effectiveNote = [note, `Breakup — ${breakup}`].filter(Boolean).join(" · ").slice(0, 500);
    }

    // --- Insert the link row (service role; amount is authoritative) ----------
    const { data: linkRow, error: insErr } = await admin
      .from("payment_links")
      .insert({
        lead_id: leadId,
        student_id: studentId,
        purpose,
        amount,
        note: effectiveNote,
        allocations,
        live_fee: liveFee,
        fee_term: liveFee ? feeTerm : null,
        fee_campaign_id: feeCampaignId,
        created_by: user.id,
        consultant_id: consultantId,
        expires_at: new Date(Date.now() + expiresDays * 86400000).toISOString(),
      } as any)
      .select("id, token")
      .single();
    if (insErr || !linkRow) return json({ error: insErr?.message || "Failed to create link" }, 500);

    const ourUrl = `${publicBase.replace(/\/$/, "")}/pay/${linkRow.token}`;
    let gateway: string | null = null;
    let gatewayLinkId: string | null = null;
    let shortUrl: string | null = null;
    const purposeLabel = purpose === "pre_admission_token"
      ? "Token fee prior to admission"
      : purpose === "fee_due" ? "Fee due" : "Payment";

    // --- Gateway: Razorpay hosted, Easebuzz EasyCollect, or UniOs /pay page --
    const wantRazorpay = !payerChoice && (gatewayPref === "razorpay" || gatewayPref === "auto");
    const wantEasebuzz = !payerChoice && (gatewayPref === "easebuzz" || gatewayPref === "auto");

    if (wantRazorpay && keyId && keySecret) {
      const rp = await razorpayCreatePaymentLink(keyId, keySecret, {
        amount: Math.round(amount * 100),
        currency: "INR",
        accept_partial: false,
        description: note || purposeLabel,
        customer: {
          name: payerName,
          ...(payerEmail ? { email: payerEmail } : {}),
          ...(payerPhone ? { contact: payerPhone } : {}),
        },
        notify: { sms: wantsWhatsApp && !!payerPhone, email: wantsEmail && !!payerEmail },
        reminder_enable: true,
        notes: { payment_link_id: linkRow.id, purpose },
        callback_url: ourUrl,
        callback_method: "get",
      });
      if (rp.ok) {
        gateway = "razorpay";
        gatewayLinkId = rp.id || null;
        shortUrl = rp.short_url || null;
      } else {
        console.error("[create-payment-link] razorpay link failed:", rp.error);
      }
    }

    // Easebuzz EasyCollect hosted link (optional product — needs EASEBUZZ_EASYCOLLECT_URL)
    if (!gateway && wantEasebuzz) {
      const merchantTxn = `EC${linkRow.id.replace(/-/g, "").slice(0, 16)}${Date.now()}`.slice(0, 40);
      const ec = await easebuzzEasyCollectCreateLink({
        merchantTxn,
        name: payerName,
        email: payerEmail || "noreply@nimteducation.com",
        phone: payerPhone || "",
        amount,
        message: note || purposeLabel,
        udf1: linkRow.id,
      });
      if (ec.ok && ec.short_url) {
        gateway = "easebuzz";
        gatewayLinkId = ec.id || merchantTxn;
        shortUrl = ec.short_url;
      } else {
        // UniOs /pay page opens the Easebuzz checkout on Pay click.
        console.warn("[create-payment-link] EasyCollect unavailable, using /pay page:", ec.error);
        gateway = "easebuzz";
      }
    }

    // Final fallback if nothing selected (payer-choice links stay unset)
    if (!gateway && !payerChoice) {
      gateway = keyId && keySecret ? "razorpay" : "easebuzz";
    }

    await admin
      .from("payment_links")
      .update({ gateway, gateway_link_id: gatewayLinkId, short_url: shortUrl } as any)
      .eq("id", linkRow.id);

    // --- Optionally notify the candidate -------------------------------------
    // WhatsApp: approved template with a Pay Now button to /pay/<token>.
    // Fails gracefully (logged by whatsapp-send) until Meta approves the
    // template — Razorpay's SMS notify above covers the gap.
    if (wantsWhatsApp && payerPhone) {
      const purposeLabel = purpose === "pre_admission_token"
        ? "Token fee prior to admission"
        : purpose === "fee_due" ? "Fee due" : "Payment";
      const validTill = new Date(Date.now() + expiresDays * 86400000)
        .toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
      fetch(`${supabaseUrl}/functions/v1/whatsapp-send`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
        body: JSON.stringify({
          template_key: "payment_link_request",
          phone: payerPhone,
          ...(leadId ? { lead_id: leadId } : {}),
          params: [payerName, purposeLabel, amount.toLocaleString("en-IN"), validTill],
          button_urls: [linkRow.token],
        }),
      }).catch((e) => console.error("[create-payment-link] whatsapp failed:", e));
    }

    // Branded email with the pay URL (Razorpay's own SMS/email above covers the
    // gateway-hosted delivery; this is the institution-branded copy).
    if (wantsEmail && payerEmail) {
      fetch(`${supabaseUrl}/functions/v1/send-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
        body: JSON.stringify({
          template_slug: "payment-link",
          to_email: payerEmail,
          ...(leadId ? { lead_id: leadId } : {}),
          variables: {
            student_name: payerName,
            amount: amount.toLocaleString("en-IN"),
            purpose_label: purpose === "pre_admission_token"
              ? "Token fee prior to admission (adjustable against admission fee)"
              : purpose === "fee_due" ? "Fee due" : "Payment",
            pay_url: ourUrl,
            note: note || "",
          },
        }),
      }).catch((e) => console.error("[create-payment-link] email failed:", e));
    }

    // pay_url is always our branded page. short_url is the gateway's own
    // hosted artifact, returned for reconcile/debugging only — never shared.
    return json({
      id: linkRow.id,
      token: linkRow.token,
      pay_url: ourUrl,
      short_url: shortUrl,
      gateway,
      amount,
    });
  } catch (error) {
    console.error("[create-payment-link] error:", error);
    return json({ error: error instanceof Error ? error.message : "Unexpected error" }, 500);
  }
});
