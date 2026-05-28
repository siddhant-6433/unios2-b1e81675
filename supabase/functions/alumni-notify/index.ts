// Email notifier for alumni service requests.
//
// Triggered by:
//   1. DB trigger on alumni_verification_requests when status → 'paid'
//      (kind: "new_request")
//   2. Daily cron (alumni-tat-reminders) on day 3, 4, 5 morning IST if
//      the request is still open (kind: "reminder")
//
// Recipients are hardcoded per product spec:
//   to:  umesh@nimt.ac.in
//   cc:  siddhant@nimt.ac.in, siddharth@nimt.ac.in

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const TO_EMAIL = "umesh@nimt.ac.in";
const CC_EMAILS = ["siddhant@nimt.ac.in", "siddharth@nimt.ac.in"];
const STAFF_DASHBOARD_URL = "https://uni.nimt.ac.in/alumni-verifications";

const SERVICE_LABELS: Record<string, string> = {
  verification: "Alumni Verification",
  marksheet: "Marksheet Request",
  diploma: "Degree / Diploma Request",
  transcript: "Transcript Request",
};

const NEXT_STEPS: Record<string, string[]> = {
  verification: [
    "Pull the alumni record from the office register / SIS.",
    "Cross-check name, course, year of passing, and enrollment.",
    "Confirm the employer / agency contact details on the request.",
    "Upload signed verification letter on the portal and mark the request as Verified or Rejected.",
  ],
  marksheet: [
    "Locate the original marksheet for the listed enrollment number and year.",
    "If duplicate, verify the FIR/police-report attachment.",
    "Print / re-issue the marksheet copy.",
    "Upload the dispatched marksheet scan on the portal and mark as Verified.",
  ],
  diploma: [
    "Locate the original degree / diploma certificate for the listed enrollment number.",
    "If duplicate, verify the FIR/police-report attachment.",
    "Print / re-issue the diploma certificate.",
    "Upload the dispatched copy on the portal and mark as Verified.",
  ],
  transcript: [
    "Compile official transcript from semester-wise marksheets.",
    "Apply the institution stamp and signature.",
    "Upload the dispatched transcript on the portal and mark as Verified.",
  ],
};

interface RequestRow {
  id: string;
  request_number: string;
  request_type: string | null;
  alumni_name: string;
  course: string;
  year_of_passing: number | null;
  campus: string | null;
  enrollment_no: string | null;
  copy_type: string | null;
  contact_name: string | null;
  contact_phone_spoc: string | null;
  contact_email: string | null;
  requestor_phone: string;
  employer_name: string | null;
  third_party_company: string | null;
  fee_amount: number | null;
  status: string;
  paid_at: string | null;
  due_date: string | null;
  created_at: string;
}

function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  } as Record<string, string>)[c]);
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric", month: "short", year: "numeric",
  });
}

function buildSubject(kind: string, daysRemaining: number, req: RequestRow): string {
  const svc = SERVICE_LABELS[req.request_type || "verification"] || "Alumni Service";
  if (kind === "new_request") {
    return `[Alumni] New ${svc} — ${req.request_number} — ${req.alumni_name} (5-day TAT)`;
  }
  // reminder
  const urgency = daysRemaining === 0
    ? "DUE TODAY"
    : daysRemaining === 1
    ? "Due Tomorrow"
    : `${daysRemaining} days left`;
  return `[Alumni] ${urgency} — ${svc} — ${req.request_number} — ${req.alumni_name}`;
}

function buildBody(kind: string, daysRemaining: number, req: RequestRow): string {
  const svc = SERVICE_LABELS[req.request_type || "verification"] || "Alumni Service";
  const steps = NEXT_STEPS[req.request_type || "verification"] || NEXT_STEPS.verification;
  const dueDate = formatDate(req.due_date);
  const paidAt = formatDate(req.paid_at);

  const banner = kind === "new_request"
    ? `<div style="background:#dbeafe;border-left:4px solid #2563eb;padding:12px 16px;margin-bottom:16px">
         <strong style="color:#1e40af">New alumni request — payment received</strong><br/>
         <span style="font-size:13px;color:#1e3a8a">
           Verification must be completed and updated on the portal by <strong>${esc(dueDate)}</strong> (5-day TAT from payment on ${esc(paidAt)}).
         </span>
       </div>`
    : `<div style="background:${daysRemaining === 0 ? "#fee2e2" : "#fef3c7"};border-left:4px solid ${daysRemaining === 0 ? "#dc2626" : "#d97706"};padding:12px 16px;margin-bottom:16px">
         <strong style="color:${daysRemaining === 0 ? "#991b1b" : "#92400e"}">
           ${daysRemaining === 0 ? "TAT closing TODAY" : `Reminder — ${daysRemaining} day${daysRemaining === 1 ? "" : "s"} left`}
         </strong><br/>
         <span style="font-size:13px;color:${daysRemaining === 0 ? "#7f1d1d" : "#78350f"}">
           Request still <strong>${esc(req.status)}</strong>. Due date: <strong>${esc(dueDate)}</strong>. Paid on ${esc(paidAt)}.
         </span>
       </div>`;

  const employerRow = req.request_type === "verification" && req.employer_name
    ? `<tr><td style="padding:6px 12px;color:#64748b">Employer / University</td><td style="padding:6px 12px">${esc(req.employer_name)}${req.third_party_company ? ` (via ${esc(req.third_party_company)})` : ""}</td></tr>`
    : "";

  const spocRow = req.contact_name
    ? `<tr><td style="padding:6px 12px;color:#64748b">SPOC</td><td style="padding:6px 12px">${esc(req.contact_name)}${req.contact_phone_spoc ? ` · ${esc(req.contact_phone_spoc)}` : ""}</td></tr>`
    : "";

  const enrollmentRow = req.enrollment_no
    ? `<tr><td style="padding:6px 12px;color:#64748b">Enrollment No.</td><td style="padding:6px 12px">${esc(req.enrollment_no)}</td></tr>`
    : "";

  const campusRow = req.campus
    ? `<tr><td style="padding:6px 12px;color:#64748b">Campus</td><td style="padding:6px 12px">${esc(req.campus)}</td></tr>`
    : "";

  const copyRow = req.copy_type
    ? `<tr><td style="padding:6px 12px;color:#64748b">Copy Type</td><td style="padding:6px 12px;text-transform:capitalize">${esc(req.copy_type)}</td></tr>`
    : "";

  return `<!DOCTYPE html>
<html><body style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;color:#0f172a;max-width:640px;margin:0 auto;padding:20px">
  <h2 style="margin:0 0 6px;color:#0f172a">${esc(svc)} — ${esc(req.request_number)}</h2>
  <p style="margin:0 0 16px;color:#475569;font-size:14px">NIMT Educational Institutions · Alumni Services</p>

  ${banner}

  <table cellpadding="0" cellspacing="0" style="width:100%;border:1px solid #e2e8f0;border-radius:8px;border-collapse:separate;font-size:14px;margin-bottom:20px">
    <tr><td style="padding:6px 12px;color:#64748b;width:160px">Alumni</td><td style="padding:6px 12px"><strong>${esc(req.alumni_name)}</strong></td></tr>
    <tr><td style="padding:6px 12px;color:#64748b">Course</td><td style="padding:6px 12px">${esc(req.course)}${req.year_of_passing ? ` (${esc(req.year_of_passing)})` : ""}</td></tr>
    ${enrollmentRow}
    ${campusRow}
    ${copyRow}
    <tr><td style="padding:6px 12px;color:#64748b">Phone</td><td style="padding:6px 12px">${esc(req.requestor_phone)}</td></tr>
    <tr><td style="padding:6px 12px;color:#64748b">Email</td><td style="padding:6px 12px">${esc(req.contact_email || "—")}</td></tr>
    ${employerRow}
    ${spocRow}
    <tr><td style="padding:6px 12px;color:#64748b">Fee paid</td><td style="padding:6px 12px">₹${esc(req.fee_amount || "")}</td></tr>
    <tr><td style="padding:6px 12px;color:#64748b">Due date</td><td style="padding:6px 12px"><strong>${esc(dueDate)}</strong></td></tr>
  </table>

  <h3 style="margin:0 0 8px;font-size:15px">Next steps</h3>
  <ol style="margin:0 0 20px;padding-left:20px;color:#334155;font-size:14px;line-height:1.6">
    ${steps.map((s) => `<li>${esc(s)}</li>`).join("")}
  </ol>

  <div style="margin:24px 0">
    <a href="${STAFF_DASHBOARD_URL}" style="display:inline-block;background:#2563eb;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;font-size:14px;font-weight:600">
      Open Alumni Verifications dashboard
    </a>
  </div>

  <p style="margin:24px 0 0;color:#94a3b8;font-size:12px">
    This is an automated notification. To stop reminders, update the request status to <strong>Verified</strong> or <strong>Rejected</strong> on the portal.
  </p>
</body></html>`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });

    const { kind, request_id, days_remaining } = await req.json();

    if (!request_id || (kind !== "new_request" && kind !== "reminder")) {
      return new Response(JSON.stringify({ error: "kind and request_id required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: row, error } = await admin
      .from("alumni_verification_requests")
      .select("id, request_number, request_type, alumni_name, course, year_of_passing, campus, enrollment_no, copy_type, contact_name, contact_phone_spoc, contact_email, requestor_phone, employer_name, third_party_company, fee_amount, status, paid_at, due_date, created_at")
      .eq("id", request_id)
      .single<RequestRow>();

    if (error || !row) {
      return new Response(JSON.stringify({ error: `Request not found: ${request_id}` }), {
        status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Suppress reminders if already resolved
    if (kind === "reminder" && ["verified", "rejected"].includes(row.status)) {
      return new Response(JSON.stringify({ skipped: true, reason: `status=${row.status}` }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const daysRem = typeof days_remaining === "number" ? days_remaining : 0;
    const subject = buildSubject(kind, daysRem, row);
    const body = buildBody(kind, daysRem, row);

    const emailRes = await fetch(`${supabaseUrl}/functions/v1/send-email`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        to_email: TO_EMAIL,
        cc: CC_EMAILS,
        custom_subject: subject,
        custom_body: body,
      }),
    });

    const emailJson = await emailRes.json().catch(() => ({}));
    if (!emailRes.ok) {
      console.error("[alumni-notify] send-email failed:", emailRes.status, emailJson);
      return new Response(JSON.stringify({ error: emailJson?.error || "Email send failed", upstream_status: emailRes.status }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ success: true, kind, request_id, days_remaining: daysRem, email_id: emailJson?.id }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("[alumni-notify] error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
