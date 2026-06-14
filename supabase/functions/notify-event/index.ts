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
// Finance ops mailbox — every payment + admission notification CCs / sends
// here with the receipt PDF attached. Override via FINANCE_EMAIL env if the
// destination changes.
const FINANCE_EMAIL = Deno.env.get("FINANCE_EMAIL") || "finance@nimt.ac.in";

type EventName = "app_submitted" | "app_fee_paid" | "app_approved" | "offer_issued" | "pan_issued" | "payment_received" | "payment_corrected" | "doc_rejected" | "application_rejected" | "admission_issued" | "token_fee_reminder";

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

  // Auth — accept:
  //   (a) the service-role token (used by DB pg_net trigger + edge-to-edge
  //       calls like easebuzz/icici callbacks), OR
  //   (b) an authenticated user JWT whose user_id maps to one of the
  //       admin-level roles in user_roles. This lets the client-side
  //       OfflinePaymentDialog / RecordPaymentDialog / "Resend receipt"
  //       button invoke notify-event directly without going through pg_net,
  //       which has been observed to drop silently in production.
  const auth = req.headers.get("authorization") ?? "";
  if (!auth.startsWith("Bearer ")) return json({ error: "unauthorized" }, 401);
  const token = auth.slice(7);
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  let okAuth = !!(serviceRoleKey && token === serviceRoleKey);
  let jwtUserId: string | null = null;
  let jwtRole: string | null = null;
  if (!okAuth) {
    try {
      const [, payloadB64] = token.split(".");
      if (payloadB64) {
        const payload = JSON.parse(atob(payloadB64.replace(/-/g, "+").replace(/_/g, "/")));
        jwtRole = payload?.role ?? null;
        jwtUserId = payload?.sub ?? null;
        if (jwtRole === "service_role") okAuth = true;
      }
    } catch { /* malformed token */ }
  }

  // If the caller wasn't service-role, accept an authenticated admin user.
  // The JWT signature is verified by Supabase's gateway before the function
  // runs (verify_jwt = true by default), so we can trust `sub` + `role`.
  if (!okAuth && jwtRole === "authenticated" && jwtUserId) {
    const SUPABASE_URL_FOR_AUTH = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY_FOR_AUTH = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminCheck = createClient(SUPABASE_URL_FOR_AUTH, SERVICE_KEY_FOR_AUTH);
    const { data: roles } = await adminCheck
      .from("user_roles")
      .select("role")
      .eq("user_id", jwtUserId);
    const allowed = new Set(["super_admin", "campus_admin", "admission_head", "principal", "accountant", "counsellor"]);
    if ((roles || []).some((r: any) => allowed.has(r.role))) okAuth = true;
  }

  if (!okAuth) return json({ error: "unauthorized" }, 401);

  let body: NotifyBody;
  try { body = await req.json(); } catch { return json({ error: "invalid json" }, 400); }
  if (!body.event || !body.lead_id) return json({ error: "event and lead_id required" }, 400);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const db = createClient(SUPABASE_URL, SERVICE_KEY);

  // ── Load shared lead context ────────────────────────────────────────
  const { data: lead, error: leadErr } = await db
    .from("leads")
    .select("id, name, phone, email, counsellor_id, course_id, campus_id, admission_no, pre_admission_no, courses:course_id(name), campuses:campus_id(name)")
    .eq("id", body.lead_id)
    .maybeSingle();
  if (leadErr || !lead) return json({ error: "lead not found" }, 404);

  // Once admission_no is issued the candidate is a student — counsellor /
  // team-leader involvement ends, only finance + super-admin (+ student
  // themselves) should be notified about money flows. This switch is used
  // for `payment_received`, `app_fee_paid`, and `payment_corrected`.
  const isPostAdmission = !!lead.admission_no;
  const paymentStaffSet = isPostAdmission
    ? { counsellor: false, leader: false, super_admin: true }
    : { counsellor: true,  leader: true,  super_admin: true };

  // ── Recipient resolution helpers ────────────────────────────────────
  // Counsellor + their team leader + all super_admins.
  // Returns deduped lowercase email list. `which` controls which group
  // to include (events 3+4 only notify the applicant).
  //
  // IMPORTANT join semantics:
  //   leads.counsellor_id   → profiles.id  (NOT auth.users.id)
  //   team_members.user_id  → auth.users.id
  //   teams.leader_id       → profiles.id  (per existing RLS policies)
  //
  // So the team-leader chain needs counsellor profile.user_id first.
  const resolveEmails = async (which: { counsellor: boolean; leader: boolean; super_admin: boolean }): Promise<string[]> => {
    const emails = new Set<string>();
    let counsellorUserId: string | null = null;

    if ((which.counsellor || which.leader) && lead.counsellor_id) {
      const { data } = await db
        .from("profiles")
        .select("email, user_id")
        .eq("id", lead.counsellor_id)
        .maybeSingle();
      if (which.counsellor && data?.email) emails.add(String(data.email).toLowerCase());
      counsellorUserId = (data?.user_id as string) ?? null;
    }

    if (which.leader && counsellorUserId) {
      const { data: tm } = await db
        .from("team_members")
        .select("team_id")
        .eq("user_id", counsellorUserId);
      const teamIds = (tm || []).map((r: any) => r.team_id);
      if (teamIds.length) {
        const { data: teams } = await db.from("teams").select("leader_id").in("id", teamIds);
        const leaderProfileIds = (teams || []).map((t: any) => t.leader_id).filter(Boolean);
        if (leaderProfileIds.length) {
          const { data: leaders } = await db.from("profiles").select("email").in("id", leaderProfileIds);
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
  // `phoneOverride` lets the caller mirror a template to staff phones
  // (counsellor / leader / super_admin) — defaults to the applicant.
  const sendWhatsApp = async (
    template_key: string,
    params: string[],
    button_urls?: string[],
    phoneOverride?: string,
  ) => {
    const phone = phoneOverride ?? lead.phone;
    if (!phone) return;
    try {
      await fetch(`${SUPABASE_URL}/functions/v1/whatsapp-send`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
        body: JSON.stringify({
          template_key, phone, lead_id: lead.id, params,
          ...(button_urls?.length ? { button_urls } : {}),
        }),
      });
    } catch (e) {
      console.error(`[notify-event] whatsapp ${template_key}→${phone} failed:`, e);
    }
  };

  // Mirror image of resolveEmails — pulls phone numbers for the same
  // counsellor / team-leader / super-admin set. Used when a payment
  // notification needs to be cc'd via WhatsApp as well as email.
  const resolveStaffPhones = async (which: { counsellor: boolean; leader: boolean; super_admin: boolean }): Promise<string[]> => {
    const phones = new Set<string>();
    let counsellorUserId: string | null = null;

    if ((which.counsellor || which.leader) && lead.counsellor_id) {
      const { data } = await db
        .from("profiles")
        .select("phone, user_id")
        .eq("id", lead.counsellor_id)
        .maybeSingle();
      if (which.counsellor && data?.phone) phones.add(String(data.phone));
      counsellorUserId = (data?.user_id as string) ?? null;
    }

    if (which.leader && counsellorUserId) {
      const { data: tm } = await db
        .from("team_members")
        .select("team_id")
        .eq("user_id", counsellorUserId);
      const teamIds = (tm || []).map((r: any) => r.team_id);
      if (teamIds.length) {
        const { data: teams } = await db.from("teams").select("leader_id").in("id", teamIds);
        const leaderProfileIds = (teams || []).map((t: any) => t.leader_id).filter(Boolean);
        if (leaderProfileIds.length) {
          const { data: leaders } = await db.from("profiles").select("phone").in("id", leaderProfileIds);
          (leaders || []).forEach((l: any) => l.phone && phones.add(String(l.phone)));
        }
      }
    }

    if (which.super_admin) {
      const { data: roles } = await db.from("user_roles").select("user_id").eq("role", "super_admin");
      const userIds = (roles || []).map((r: any) => r.user_id);
      if (userIds.length) {
        const { data: profs } = await db.from("profiles").select("phone").in("user_id", userIds);
        (profs || []).forEach((p: any) => p.phone && phones.add(String(p.phone)));
      }
    }

    return [...phones];
  };

  const sendEmail = async (
    template_slug: string,
    to_email: string,
    variables: Record<string, unknown>,
    opts: { attachments?: { filename: string; url: string }[]; cc?: string | string[] } = {},
  ) => {
    if (!to_email) return;
    try {
      await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
        body: JSON.stringify({
          template_slug, to_email, lead_id: lead.id, variables,
          ...(opts.attachments?.length ? { attachments: opts.attachments } : {}),
          ...(opts.cc ? { cc: opts.cc } : {}),
        }),
      });
    } catch (e) {
      console.error(`[notify-event] email ${template_slug}→${to_email} failed:`, e);
    }
  };

  // Synchronously make sure a payment row has its receipt_url + receipt_no
  // populated before we email/WA the link. Falls through silently if the
  // generator is unreachable — caller still has the lead-CRM fallback.
  const ensureReceipt = async (
    payment_id: string,
    application_id?: string | null,
  ): Promise<{ receipt_url: string | null; receipt_no: string | null }> => {
    const fresh = async () => {
      const { data } = await db
        .from("lead_payments")
        .select("receipt_url, receipt_no, status")
        .eq("id", payment_id).maybeSingle();
      return { receipt_url: data?.receipt_url ?? null, receipt_no: data?.receipt_no ?? null, status: data?.status ?? null };
    };
    let row = await fresh();
    if (row.receipt_url && !application_id) return row;
    if (row.status !== "confirmed") return row;

    // Generator runs synchronously and updates the row in-place.
    try {
      await fetch(`${SUPABASE_URL}/functions/v1/generate-payment-receipt`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
        body: JSON.stringify({ payment_id, application_id: application_id || undefined }),
      });
      // brief retry — DB may need a beat to commit
      for (let i = 0; i < 3; i++) {
        row = await fresh();
        if (row.receipt_url) return row;
        await new Promise(r => setTimeout(r, 600));
      }
    } catch (e) {
      console.error(`[notify-event] generate-payment-receipt(${payment_id}) failed:`, e);
    }
    return row;
  };

  // Mints a multi-use apply-portal magic token for "accept offer / pay
  // token / pay balance" CTAs. 30-day expiry — student may take a while.
  // Returns BOTH the token (for WhatsApp button URL params, where Meta
  // only substitutes the {{1}} suffix of the template URL) AND the full
  // URL (for body text or other channels).
  const mintApplyMagicLink = async (): Promise<{ token: string; url: string }> => {
    const expires = new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString();
    const { data } = await db.from("apply_magic_tokens").insert({
      lead_id: lead.id,
      phone: lead.phone || "",
      email: lead.email,
      expires_at: expires,
    }).select("token").single();
    const token = String(data?.token ?? "");
    return { token, url: `${APPLY_PORTAL_BASE}?token=${token}` };
  };

  const courseName = (lead.courses as any)?.name || "your programme";
  const campusName = (lead.campuses as any)?.name || "";
  const leadUrl = `${CRM_BASE}/leads/${lead.id}`;
  const appIdFromNotes = (notes?: unknown): string | null => {
    const match = String(notes || "").match(/APP-\d{2}-[A-Z0-9]+/i);
    return match?.[0]?.toUpperCase() || null;
  };

  // ── Event router ────────────────────────────────────────────────────
  switch (body.event) {

    // 1. APPLICATION SUBMITTED
    case "app_submitted": {
      const application_id = (body.context?.application_id as string) || "";
      const { data: app } = await db
        .from("applications").select("application_id, form_pdf_url, full_name, phone, email")
        .eq("application_id", application_id).maybeSingle();
      // CRM application detail page — fallback when form_pdf_url isn't yet
      // populated (PDF generator runs in parallel with notify-event and
      // may not have stored the URL by the time this email fires). Staff
      // can open the CRM page and download the PDF inline from there.
      const appDetailUrl = `${CRM_BASE}/applications/${application_id}`;
      const formPdf = app?.form_pdf_url || appDetailUrl;

      // PDF templates use a static URL button to the apply portal —
      // applicant authenticates there to retrieve the actual signed PDF.
      // No button_urls passed (template button has no {{1}} placeholder).
      await sendWhatsApp("application_submitted",
        [lead.name || app?.full_name || "Student", application_id],
      );

      const recipients = await resolveEmails({ counsellor: true, leader: true, super_admin: true });
      const vars = {
        student_name: lead.name || app?.full_name || "Student",
        application_id, course_name: courseName, campus_name: campusName,
        phone: lead.phone || app?.phone || "", email: lead.email || app?.email || "",
        form_pdf_url: formPdf, lead_url: leadUrl,
      };
      // Serialise (Resend free-tier rate limit is 2/sec; 4 parallel sends
      // get throttled). Small delay between recipients keeps us well under.
      for (const e of recipients) { await sendEmail("application-submitted-internal", e, vars); await new Promise(r => setTimeout(r, 300)); }
      break;
    }

    // 2. APPLICATION FEE PAID
    case "app_fee_paid": {
      const payment_id = body.context?.payment_id as string;
      if (!payment_id) break;
      const { data: pmt } = await db
        .from("lead_payments")
        .select("amount, transaction_ref, receipt_no, receipt_url, payment_date, application_id, notes")
        .eq("id", payment_id).maybeSingle();
      const explicitApplicationId =
        (body.context?.application_id as string | undefined) ||
        (pmt?.application_id as string | undefined) ||
        appIdFromNotes(pmt?.notes) ||
        "";
      // Make sure the receipt PDF is available — we'd rather link to it than
      // fall back to the CRM page (which is broken from the candidate's POV).
      const ensured = await ensureReceipt(payment_id, explicitApplicationId);
      let app: any = null;
      if (explicitApplicationId) {
        const { data } = await db
          .from("applications").select("application_id, fee_receipt_url, full_name")
          .eq("lead_id", lead.id)
          .eq("application_id", explicitApplicationId)
          .maybeSingle();
        app = data || null;
      }
      if (!app) {
        const { data } = await db
          .from("applications").select("application_id, fee_receipt_url, full_name")
          .eq("lead_id", lead.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
        app = data || null;
      }
      const receiptUrl = ensured.receipt_url || pmt?.receipt_url || app?.fee_receipt_url || leadUrl;
      const receiptNo  = ensured.receipt_no  || pmt?.receipt_no  || "";
      const haveReceipt = !!ensured.receipt_url || !!pmt?.receipt_url || !!app?.fee_receipt_url;

      await sendWhatsApp("app_fee_receipt",
        [lead.name || "Student", String(pmt?.amount ?? ""), app?.application_id || ""],
      );

      // Admission-aware staff list — post-admission drops counsellor/leader.
      const recipients = await resolveEmails(paymentStaffSet);
      const vars = {
        student_name: lead.name || "Student",
        amount: String(pmt?.amount ?? ""),
        application_id: app?.application_id || "",
        course_name: courseName,
        payment_ref: pmt?.transaction_ref || receiptNo,
        receipt_url: receiptUrl, lead_url: leadUrl,
      };
      // Internal stakeholders (counsellor/leader/super_admin) — PDF attached,
      // finance@nimt.ac.in CC'd so they have a record on every notification.
      const attach = haveReceipt ? [{ filename: `Receipt-${receiptNo || payment_id}.pdf`, url: receiptUrl }] : [];
      for (const e of recipients) {
        await sendEmail("app-fee-paid-internal", e, vars, { attachments: attach, cc: FINANCE_EMAIL });
        await new Promise(r => setTimeout(r, 300));
      }
      // If no admin recipients resolved (edge case), still notify finance directly.
      if (recipients.length === 0) {
        await sendEmail("app-fee-paid-internal", FINANCE_EMAIL, vars, { attachments: attach });
      }

      // Applicant email — PDF attached so they always have it even if the
      // inline link becomes stale (e.g. storage URL not yet committed).
      if (lead.email) await sendEmail("app-fee-paid-internal", lead.email, vars, { attachments: attach });
      break;
    }

    // 2b. APPLICATION APPROVED — student gets WA + email; internal team notified
    case "app_approved": {
      const application_id = (body.context?.application_id as string) || "";
      const { token: applyToken, url: applyUrl } = await mintApplyMagicLink();

      // WA to student
      await sendWhatsApp("application_approved",
        [lead.name || "Student", application_id, courseName],
        [applyToken],
      );

      // Email to student
      if (lead.email) {
        const subject = `Your application has been approved — ${application_id}`;
        const bodyHtml =
          `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">` +
          `<h2 style="color:#0f172a">Application Approved 🎉</h2>` +
          `<p>Dear ${lead.name || "Student"},</p>` +
          `<p>We are pleased to inform you that your application <strong>${application_id}</strong> for <strong>${courseName}${campusName ? ` (${campusName})` : ""}</strong> has been <strong>approved</strong>.</p>` +
          `<p>Our admissions team will issue your offer letter shortly. You can track your application status anytime via the apply portal.</p>` +
          `<p style="margin:24px 0"><a href="${applyUrl}" style="background:#0035C5;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600">Open Apply Portal →</a></p>` +
          `<p style="color:#64748b;font-size:12px">For queries, reply to this email or contact admissions@nimt.ac.in</p>` +
          `</div>`;
        await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
          body: JSON.stringify({
            custom_subject: subject,
            custom_body: bodyHtml,
            to_email: lead.email,
            lead_id: lead.id,
          }),
        });
      }

      // Notify internal team (counsellor only — approval is a one-line update)
      const recipients = await resolveEmails({ counsellor: true, leader: false, super_admin: false });
      const internalSubject = `Application approved — ${application_id} (${lead.name || "Student"})`;
      const internalBody =
        `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">` +
        `<h2 style="color:#0f172a">Application approved</h2>` +
        `<p>${lead.name || "Student"}'s application <strong>${application_id}</strong> for <strong>${courseName}</strong> has been approved.</p>` +
        `<p><a href="${leadUrl}" style="color:#0047FF">Open lead in CRM →</a></p>` +
        `</div>`;
      for (const e of recipients) {
        await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
          body: JSON.stringify({ custom_subject: internalSubject, custom_body: internalBody, to_email: e, lead_id: lead.id }),
        });
        await new Promise(r => setTimeout(r, 300));
      }
      break;
    }

    // 3. OFFER LETTER ISSUED — applicant WA + email, with offer PDF + magic pay link
    case "offer_issued": {
      const offer_id = body.context?.offer_id as string;
      if (!offer_id) break;
      const { data: offer } = await db
        .from("offer_letters")
        .select("net_fee, scholarship_amount, total_fee, acceptance_deadline, letter_url")
        .eq("id", offer_id).maybeSingle();
      if (!offer) break;

      const { token: payToken, url: payUrl } = await mintApplyMagicLink();

      const deadline = offer.acceptance_deadline
        ? new Date(offer.acceptance_deadline).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })
        : "the deadline";

      // WA — button token only; Meta builds https://uni.nimt.ac.in/apply?token={{1}}
      await sendWhatsApp("offer_letter_issued",
        [lead.name || "Student", courseName, String(offer.net_fee ?? ""), deadline],
        [payToken],
      );

      // Email to student
      if (lead.email) {
        // MBA: hide the offer letter PDF — show fee details + portal CTA only
        const isMba = /\bMBA\b/i.test(courseName);
        const offerAttach = (!isMba && offer.letter_url)
          ? [{ filename: `Offer-Letter-${lead.name?.replace(/\s+/g, "-") || "Student"}.pdf`, url: offer.letter_url }]
          : [];
        const offerSubject = `Your offer letter is ready — ${courseName}`;
        const offerBody =
          `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:24px">` +
          `<h2 style="color:#0f172a">Offer Letter Issued 🎓</h2>` +
          `<p>Dear ${lead.name || "Student"},</p>` +
          `<p>Congratulations! Your offer letter for <strong>${courseName}${campusName ? ` — ${campusName}` : ""}</strong> is ready.</p>` +
          `<table style="width:100%;border-collapse:collapse;margin:16px 0">` +
          `<tr><td style="padding:8px;border:1px solid #ddd">Net Fee</td><td style="padding:8px;border:1px solid #ddd"><strong>₹${Number(offer.net_fee || 0).toLocaleString("en-IN")}</strong></td></tr>` +
          `<tr><td style="padding:8px;border:1px solid #ddd">Accept by</td><td style="padding:8px;border:1px solid #ddd">${deadline}</td></tr>` +
          `</table>` +
          `<p>${offerAttach.length ? "The offer letter PDF is attached. " : ""}To accept your offer and pay the token fee to confirm your admission, use the portal link below.</p>` +
          `<p style="margin:24px 0"><a href="${payUrl}" style="background:#0035C5;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600">View & Accept Offer →</a></p>` +
          `<p style="color:#64748b;font-size:12px">For queries contact admissions@nimt.ac.in</p>` +
          `</div>`;
        await fetch(`${SUPABASE_URL}/functions/v1/send-email`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${SERVICE_KEY}` },
          body: JSON.stringify({
            custom_subject: offerSubject,
            custom_body: offerBody,
            to_email: lead.email,
            lead_id: lead.id,
            ...(offerAttach.length ? { attachments: offerAttach } : {}),
          }),
        });
      }
      break;
    }

    // 3b. TOKEN FEE REMINDER — fired by cron at 2d/1d/4h before deadline
    case "token_fee_reminder": {
      const offer_id = body.context?.offer_id as string;
      const milestone = (body.context?.milestone as string) || "soon";
      if (!offer_id) break;

      const { data: offer } = await db
        .from("offer_letters")
        .select("net_fee, token_fee_amount, acceptance_deadline")
        .eq("id", offer_id).maybeSingle();
      if (!offer) break;

      const amount = Number(offer.token_fee_amount ?? offer.net_fee ?? 0);
      const timeLeft =
        milestone === "4h" ? "just 4 hours"
        : milestone === "1d" ? "1 day"
        : milestone === "2d" ? "2 days"
        : "soon";

      const { token: payToken } = await mintApplyMagicLink();

      await sendWhatsApp("token_fee_reminder",
        [lead.name || "Student", courseName, amount.toLocaleString("en-IN"), timeLeft],
        [payToken],
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

      const { token: payToken } = await mintApplyMagicLink();
      // Pass token only — Meta substitutes the {{1}} suffix of the
      // template URL https://uni.nimt.ac.in/apply?token={{1}}
      await sendWhatsApp("pan_nudge_balance",
        [lead.name || "Student", pre_admission_no, balance.toLocaleString("en-IN")],
        [payToken],
      );
      break;
    }

    // 5b. CORRECTION NOTICE — a super-admin edited an existing receipt and
    // chose to inform the candidate. Clear receipt_url so the PDF gets
    // regenerated with the new figures, then fall through to the same
    // payment_received flow which already attaches the (new) PDF and
    // re-sends the WhatsApp + email.
    case "payment_corrected": {
      const payment_id = body.context?.payment_id as string;
      if (!payment_id) break;
      await db.from("lead_payments").update({ receipt_url: null }).eq("id", payment_id);
      // Intentional fallthrough — handled by the payment_received block below.
      // eslint-disable-next-line no-fallthrough
    }

    // 5. ANY OTHER FEE PAID (token / registration / other) — applicant + admin
    case "payment_received": {
      const payment_id = body.context?.payment_id as string;
      if (!payment_id) break;
      const ensured = await ensureReceipt(payment_id);
      const { data: pmt } = await db
        .from("lead_payments")
        .select("amount, type, payment_mode, transaction_ref, receipt_no, receipt_url, payment_date")
        .eq("id", payment_id).maybeSingle();
      if (!pmt) break;
      const receiptUrl = ensured.receipt_url || pmt.receipt_url || "";
      const receiptNo  = ensured.receipt_no  || pmt.receipt_no  || "";
      const haveReceipt = !!receiptUrl;

      const TYPE_LABEL: Record<string, string> = {
        application_fee:  "Application Fee",
        token_fee:        "Token Fee",
        registration_fee: "Registration Fee",
        other:            "Other Charges",
      };
      const waParams = [
        lead.name || "Student",
        TYPE_LABEL[pmt.type as string] || pmt.type || "Fee",
        String(pmt.amount),
        receiptNo,
        receiptUrl,
      ];
      // Applicant — primary recipient.
      await sendWhatsApp("payment_receipt", waParams);

      // Mirror to staff phones — post-admission drops counsellor/leader so
      // a student's course-fee receipt doesn't ping the counsellor who
      // shepherded them through admissions months ago. Pre-admission keeps
      // the full set so the counsellor sees their lead's money flow.
      const staffPhones = await resolveStaffPhones(paymentStaffSet);
      for (const p of staffPhones) {
        // Skip duplicate sends if a staff member shares the lead's phone.
        if (lead.phone && p.replace(/\D/g, "") === lead.phone.replace(/\D/g, "")) continue;
        await sendWhatsApp("payment_receipt", waParams, undefined, p);
        await new Promise(r => setTimeout(r, 300));
      }

      const vars = {
        student_name: lead.name || "Student",
        amount: String(pmt.amount), phone: lead.phone || "",
        payment_mode: pmt.payment_mode || "",
        payment_type: pmt.type || "",
        receipt_no: receiptNo,
        payment_ref: pmt.transaction_ref || "",
        payment_date: pmt.payment_date ? new Date(pmt.payment_date).toLocaleString("en-IN") : "",
        receipt_url: receiptUrl || leadUrl, lead_url: leadUrl,
      };

      const attach = haveReceipt ? [{ filename: `Receipt-${receiptNo || payment_id}.pdf`, url: receiptUrl }] : [];

      // Internal stakeholders — admission-aware. Finance CC'd on every send.
      const recipients = await resolveEmails(paymentStaffSet);
      for (const e of recipients) {
        await sendEmail("payment-received-internal", e, vars, { attachments: attach, cc: FINANCE_EMAIL });
        await new Promise(r => setTimeout(r, 300));
      }
      // No internal recipients resolved → still notify finance so the receipt isn't lost.
      if (recipients.length === 0) {
        await sendEmail("payment-received-internal", FINANCE_EMAIL, vars, { attachments: attach });
      }

      // Applicant — PDF attached so they always have it even if the inline link is stale.
      if (lead.email) await sendEmail("payment-received-internal", lead.email, vars, { attachments: attach });
      break;
    }

    // 6. ADMISSION ISSUED — student gets welcome email + WA, finance gets notice
    case "admission_issued": {
      const admission_no = (body.context?.admission_no as string) || "";

      // Best-effort student-portal-claim link so the welcome email links
      // to the right place (the existing trg_send_student_claim_link
      // posts the WhatsApp; we just want the URL for the email body).
      let portalUrl = `${CRM_BASE}/student-portal`;
      try {
        const { data: tok } = await db
          .from("student_magic_tokens")
          .select("token, expires_at")
          .eq("lead_id", lead.id)
          .order("created_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (tok?.token) portalUrl = `${CRM_BASE}/student-portal?token=${tok.token}`;
      } catch { /* fallback to plain portal URL */ }

      // WhatsApp to student — the existing trg_send_student_claim_link
      // sends `student_portal_invite` separately. We send a complementary
      // welcome template if it exists; failures are silent.
      try {
        await sendWhatsApp("student_admitted_welcome",
          [lead.name || "Student", admission_no, courseName],
        );
      } catch { /* template may not exist on every WABA */ }

      const vars = {
        student_name: lead.name || "Student",
        admission_no,
        course_name: courseName,
        campus_name: campusName,
        portal_url: portalUrl,
        lead_url: leadUrl,
      };

      // Welcome email to the student (template: student-admitted-welcome)
      if (lead.email) await sendEmail("student-admitted-welcome", lead.email, vars);

      // Notify finance/admin so they can flag the new admission in their books.
      await sendEmail("admission-issued-internal", FINANCE_EMAIL, vars);

      // Counsellor + super_admin internal note (uses the same template;
      // they already see the notification in-app).
      const recipients = await resolveEmails({ counsellor: true, leader: false, super_admin: true });
      for (const e of recipients) { await sendEmail("admission-issued-internal", e, vars); await new Promise(r => setTimeout(r, 300)); }
      break;
    }

    // 6. DOCUMENT REJECTED — applicant gets WA telling them which doc + why
    case "doc_rejected": {
      const file_path = (body.context?.file_path as string) || "";
      const reason = (body.context?.reason as string) || "Please contact admissions for details.";
      // Filename is the bit after the last "/" in the storage path
      const docName = file_path.split("/").pop() || "uploaded document";

      await sendWhatsApp("doc_rejected",
        [lead.name || "Student", docName, reason],
      );
      break;
    }

    // 7. APPLICATION REJECTED — applicant gets WA with rejection reason
    case "application_rejected": {
      const application_id = (body.context?.application_id as string) || "";
      const reason = (body.context?.reason as string) || "Please contact admissions for details.";

      await sendWhatsApp("application_rejected",
        [lead.name || "Student", application_id, reason],
      );
      break;
    }

    default:
      return json({ error: `unknown event: ${body.event}` }, 400);
  }

  return json({ ok: true });
});
