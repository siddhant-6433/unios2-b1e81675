/**
 * notify-event — multi-channel relay for the 5 admission lifecycle events
 * ─────────────────────────────────────────────────────────────────────────
 * Single brain that decides:
 *   - which WhatsApp template (if any) goes to the applicant
 *   - which email template goes to which staff recipients
 *   - any magic links that need to be minted (offer-pay, PAN-balance-pay)
 *
 * Triggers (DB) + ApplyPortal.tsx (app code) call this with:
 *   { event: '<name>', lead_id, context: { payment_id?, offer_id?, application_id?, ... } }
 *
 * Auth: service-role JWT (decoded — format-agnostic, mirrors the
 * ga-conversions fix). Inter-service callers from Supabase cron / triggers
 * already pass it via pg_net.
 *
 * The function is intentionally fire-and-forget per channel — one channel
 * failing doesn't block the others. All sends get logged via the underlying
 * whatsapp-send / send-email functions (whatsapp_messages, email_messages).
 */

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const APPLY_PORTAL_BASE = Deno.env.get("APPLY_PORTAL_BASE") || "https://uni.nimt.ac.in/apply";
const CRM_BASE = Deno.env.get("CRM_BASE") || "https://uni.nimt.ac.in";

type EventName = "app_submitted" | "app_fee_paid" | "offer_issued" | "pan_issued" | "payment_received";

interface NotifyBody {
  event: EventName;
  lead_id: string;
  context?: Record<string, unknown>;
}

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  // Auth — accept any JWT with role=service_role
  const auth = req.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);
  try {
    const [, payloadB64] = auth.slice(7).split(".");
    if (!payloadB64) throw new Error("malformed token");
    const payload = JSON.parse(atob(payloadB64.replace(/-/g, "+").replace(/_/g, "/")));
    if (payload?.role !== "service_role") throw new Error("not service role");
  } catch {
    return json({ error: "unauthorized" }, 401);
  }

  let body: NotifyBody;
  try { body = await req.json(); } catch { return json({ error: "invalid json" }, 400); }
  if (!body.event || !body.lead_id) return json({ error: "event and lead_id required" }, 400);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const db = createClient(SUPABASE_URL, SERVICE_KEY);

  // ── Load shared lead context ────────────────────────────────────────
  const { data: lead, error: leadErr } = await db
    .from("leads")
    .select("id, name, phone, email, counsellor_id, course_id, campus_id, courses:course_id(name), campuses:campus_id(name)")
    .eq("id", body.lead_id)
    .maybeSingle();
  if (leadErr || !lead) return json({ error: "lead not found" }, 404);

  // ── Recipient resolution helpers ────────────────────────────────────
  // Counsellor + their team leader + all super_admins.
  // Returns deduped lowercase email list. `which` controls which group
  // to include (events 3+4 only notify the applicant).
  const resolveEmails = async (which: { counsellor: boolean; leader: boolean; super_admin: boolean }): Promise<string[]> => {
    const emails = new Set<string>();

    if (which.counsellor && lead.counsellor_id) {
      const { data } = await db.from("profiles").select("email").eq("id", lead.counsellor_id).maybeSingle();
      if (data?.email) emails.add(String(data.email).toLowerCase());
    }

    if (which.leader && lead.counsellor_id) {
      // counsellor profile → team_members → teams.leader_id → leader profile email
      const { data: tm } = await db
        .from("team_members")
        .select("team_id")
        .eq("profile_id", lead.counsellor_id);
      const teamIds = (tm || []).map((r: any) => r.team_id);
      if (teamIds.length) {
        const { data: teams } = await db.from("teams").select("leader_id").in("id", teamIds);
        const leaderIds = (teams || []).map((t: any) => t.leader_id).filter(Boolean);
        if (leaderIds.length) {
          const { data: leaders } = await db.from("profiles").select("email").in("id", leaderIds);
          (leaders || []).forEach((l: any) => l.email && emails.add(String(l.email).toLowerCase()));
        }
      }
    }

    if (which.super_admin) {
      const { data: roles } = await db.from("user_roles").select("user_id").eq("role", "super_admin");
      const userIds = (roles || []).map((r: any) => r.user_id);
      if (userIds.length) {
        const { data: profs } = await db.from("profiles").select("email").in("user_id", userIds);
        (profs || []).forEach((p: any) => p.email && emails.add(String(p.email).toLowerCase()));
      }
    }

    return [...emails];
  };

  // ── Channel callers (fire-and-forget, log on caller side) ──────────
  const sendWhatsApp = async (template_key: string, params: string[], button_urls?: string[]) => {
    if (!lead.phone) return;
    try {
      await fetch(`${SUPABASE_URL}/functions/v1/whatsapp-send`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
        body: JSON.stringify({
          template_key, phone: lead.phone, lead_id: lead.id, params,
          ...(button_urls?.length ? { button_urls } : {}),
        }),
      });
    } catch (e) {
      console.error(`[notify-event] whatsapp ${template_key} failed:`, e);
    }
  };

  const sendEmail = async (template_slug: string, to_email: string, variables: Record<string, unknown>) => {
    if (!to_email) return;
    try {
      await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
        body: JSON.stringify({ template_slug, to_email, lead_id: lead.id, variables }),
      });
    } catch (e) {
      console.error(`[notify-event] email ${template_slug}→${to_email} failed:`, e);
    }
  };

  // Mints a multi-use apply-portal magic token for "accept offer / pay
  // token / pay balance" CTAs. 30-day expiry — student may take a while.
  const mintApplyMagicLink = async (): Promise<string> => {
    const expires = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
    const { data } = await db.from("apply_magic_tokens").insert({
      lead_id: lead.id,
      phone: lead.phone || "",
      email: lead.email,
      expires_at: expires,
    }).select("token").single();
    return `${APPLY_PORTAL_BASE}?token=${data?.token ?? ""}`;
  };

  const courseName = (lead.courses as any)?.name || "your programme";
  const campusName = (lead.campuses as any)?.name || "";
  const leadUrl = `${CRM_BASE}/leads/${lead.id}`;

  // ── Event router ────────────────────────────────────────────────────
  switch (body.event) {

    // 1. APPLICATION SUBMITTED
    case "app_submitted": {
      const application_id = (body.context?.application_id as string) || "";
      const { data: app } = await db
        .from("applications").select("application_id, form_pdf_url, full_name, phone, email")
        .eq("application_id", application_id).maybeSingle();
      const formPdf = app?.form_pdf_url || "";

      await sendWhatsApp("application_submitted",
        [lead.name || app?.full_name || "Student", application_id],
        formPdf ? [formPdf] : undefined,
      );

      const recipients = await resolveEmails({ counsellor: true, leader: true, super_admin: true });
      const vars = {
        student_name: lead.name || app?.full_name || "Student",
        application_id, course_name: courseName, campus_name: campusName,
        phone: lead.phone || app?.phone || "", email: lead.email || app?.email || "",
        form_pdf_url: formPdf, lead_url: leadUrl,
      };
      await Promise.all(recipients.map(e => sendEmail("application-submitted-internal", e, vars)));
      break;
    }

    // 2. APPLICATION FEE PAID
    case "app_fee_paid": {
      const payment_id = body.context?.payment_id as string;
      if (!payment_id) break;
      const { data: pmt } = await db
        .from("lead_payments")
        .select("amount, transaction_ref, receipt_no, receipt_url, payment_date")
        .eq("id", payment_id).maybeSingle();
      const { data: app } = await db
        .from("applications").select("application_id, fee_receipt_url, full_name")
        .eq("lead_id", lead.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
      const receiptUrl = pmt?.receipt_url || app?.fee_receipt_url || "";

      await sendWhatsApp("app_fee_receipt",
        [lead.name || "Student", String(pmt?.amount ?? ""), app?.application_id || ""],
        receiptUrl ? [receiptUrl] : undefined,
      );

      const recipients = await resolveEmails({ counsellor: true, leader: true, super_admin: true });
      const vars = {
        student_name: lead.name || "Student",
        amount: String(pmt?.amount ?? ""),
        application_id: app?.application_id || "",
        course_name: courseName,
        payment_ref: pmt?.transaction_ref || pmt?.receipt_no || "",
        receipt_url: receiptUrl, lead_url: leadUrl,
      };
      await Promise.all(recipients.map(e => sendEmail("app-fee-paid-internal", e, vars)));
      break;
    }

    // 3. OFFER LETTER ISSUED — applicant only, with offer PDF + magic pay link
    case "offer_issued": {
      const offer_id = body.context?.offer_id as string;
      if (!offer_id) break;
      const { data: offer } = await db
        .from("offer_letters")
        .select("net_fee, scholarship_amount, total_fee, acceptance_deadline, letter_url")
        .eq("id", offer_id).maybeSingle();
      if (!offer) break;

      const payLink = await mintApplyMagicLink();
      const buttons: string[] = [];
      if (offer.letter_url) buttons.push(offer.letter_url);
      buttons.push(payLink);

      const deadline = offer.acceptance_deadline
        ? new Date(offer.acceptance_deadline).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
        : "the deadline";

      await sendWhatsApp("offer_letter_issued",
        [lead.name || "Student", courseName, String(offer.net_fee ?? ""), deadline],
        buttons,
      );
      break;
    }

    // 4. PAN ISSUED — applicant only, nudge to pay balance for AN
    case "pan_issued": {
      const pre_admission_no = (body.context?.pre_admission_no as string) || "";

      // Compute balance owed to reach the 25% AN threshold:
      // total_year1 * 0.25 - already_paid (rough; uses lead_first_year_fee + lead_fee_status)
      const { data: status } = await db.rpc("lead_fee_status" as any, { _lead_id: lead.id });
      const { data: y1 } = await db.rpc("lead_first_year_fee" as any, { _lead_id: lead.id });
      const targetTwentyFive = (Number(y1) || 0) * 0.25;
      const paid = Number((status as any)?.total_paid || 0);
      const balance = Math.max(0, Math.round(targetTwentyFive - paid));

      const payLink = await mintApplyMagicLink();
      await sendWhatsApp("pan_nudge_balance",
        [lead.name || "Student", pre_admission_no, balance.toLocaleString("en-IN")],
        [payLink],
      );
      break;
    }

    // 5. ANY OTHER FEE PAID (token / registration / other) — applicant + super admins
    case "payment_received": {
      const payment_id = body.context?.payment_id as string;
      if (!payment_id) break;
      const { data: pmt } = await db
        .from("lead_payments")
        .select("amount, type, payment_mode, transaction_ref, receipt_no, receipt_url, payment_date")
        .eq("id", payment_id).maybeSingle();
      if (!pmt) break;

      await sendWhatsApp("payment_receipt",
        [lead.name || "Student", String(pmt.amount), pmt.receipt_no || ""],
        pmt.receipt_url ? [pmt.receipt_url] : undefined,
      );

      const recipients = await resolveEmails({ counsellor: false, leader: false, super_admin: true });
      const vars = {
        student_name: lead.name || "Student",
        amount: String(pmt.amount), phone: lead.phone || "",
        payment_mode: pmt.payment_mode || "",
        payment_type: pmt.type || "",
        receipt_no: pmt.receipt_no || "",
        payment_ref: pmt.transaction_ref || "",
        payment_date: pmt.payment_date ? new Date(pmt.payment_date).toLocaleString("en-IN") : "",
        receipt_url: pmt.receipt_url || "", lead_url: leadUrl,
      };
      await Promise.all(recipients.map(e => sendEmail("payment-received-internal", e, vars)));
      break;
    }

    default:
      return json({ error: `unknown event: ${body.event}` }, 400);
  }

  return json({ ok: true });
});
