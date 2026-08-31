import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { isServiceCaller } from "../_shared/service-auth.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CRM_BASE = Deno.env.get("CRM_BASE") || "https://uni.nimt.ac.in";

type PgdmCertificateEvent = "submitted" | "approved" | "ready_for_collection";

interface NotifyBody {
  request_id: string;
  event: PgdmCertificateEvent;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

function requestLink(requestId: string) {
  return `${CRM_BASE}/alumni-verifications?request=${encodeURIComponent(requestId)}`;
}

function cleanPhone(phone?: string | null) {
  const digits = (phone || "").replace(/[^0-9]/g, "");
  if (!digits) return "";
  if (digits.length === 10) return `91${digits}`;
  return digits;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const db = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  if (!(await isServiceCaller(req, db))) return json({ error: "unauthorized" }, 401);

  let body: NotifyBody;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid json" }, 400);
  }

  if (!body.request_id || !body.event) return json({ error: "request_id and event required" }, 400);
  const { data: requestRow, error } = await db
    .from("alumni_verification_requests")
    .select("id, request_number, alumni_name, contact_name, contact_email, contact_phone_spoc, requestor_phone, assigned_handler_user_id, assigned_handler_name, assigned_handler_email, assigned_handler_official_phone")
    .eq("id", body.request_id)
    .maybeSingle();

  if (error || !requestRow) return json({ error: "request not found" }, 404);

  const link = requestLink(requestRow.id);
  const sends: Array<{ target: string; ok: boolean; status: number; text?: string }> = [];
  let emailSend: { target: string; ok: boolean; status: number; text?: string } | null = null;

  async function sendEmail(to_email: string, subject: string, html: string) {
    const res = await fetch(`${supabaseUrl}/functions/v1/send-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceRoleKey}` },
      body: JSON.stringify({
        to_email,
        custom_subject: subject,
        custom_body: html,
        cc: "academics@nimt.ac.in",
      }),
    });
    emailSend = {
      target: to_email,
      ok: res.ok,
      status: res.status,
      text: res.ok ? undefined : await res.text().catch(() => ""),
    };
  }

  async function sendTemplate(template_key: string, phone: string, params: string[]) {
    const cleaned = cleanPhone(phone);
    if (!cleaned) return;
    const res = await fetch(`${supabaseUrl}/functions/v1/whatsapp-send`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceRoleKey}` },
      body: JSON.stringify({ template_key, phone: cleaned, params }),
    });
    sends.push({
      target: cleaned,
      ok: res.ok,
      status: res.status,
      text: res.ok ? undefined : await res.text().catch(() => ""),
    });
  }

  if (body.event === "submitted") {
    const { data: admins } = await db
      .from("user_roles")
      .select("user_id")
      .eq("role", "super_admin");

    const adminUserIds = (admins || []).map((admin: any) => admin.user_id).filter(Boolean);
    const [{ data: employees }, { data: profiles }] = await Promise.all([
      adminUserIds.length
        ? db.from("employee_profiles").select("user_id, display_name, work_number, mobile_number").in("user_id", adminUserIds)
        : Promise.resolve({ data: [] as any[] }),
      adminUserIds.length
        ? db.from("profiles").select("user_id, display_name, email").in("user_id", adminUserIds)
        : Promise.resolve({ data: [] as any[] }),
    ]);
    const employeeByUser = new Map((employees || []).map((employee: any) => [employee.user_id, employee]));
    const profileByUser = new Map((profiles || []).map((profile: any) => [profile.user_id, profile]));

    for (const admin of admins || []) {
      const employee = employeeByUser.get((admin as any).user_id) || {};
      const profile = profileByUser.get((admin as any).user_id) || {};
      // Super admins rarely have an official work_number on their employee
      // profile; fall back to their personal mobile so the approval alert
      // still reaches them (no number on record → no send, logged as skipped).
      await sendTemplate("pgdm_certificate_submitted_admin", employee?.work_number || employee?.mobile_number, [
        employee?.display_name || profile?.display_name || "Superadmin",
        requestRow.request_number,
        requestRow.alumni_name,
        requestRow.assigned_handler_name || "Student Services handler",
        link,
      ]);
    }
  }

  if (body.event === "approved") {
    // Most staff have no official work_number on record, so fall back to the
    // assigned handler's personal mobile — otherwise the "print + notify the
    // candidate" alert silently goes nowhere.
    let handlerPhone = requestRow.assigned_handler_official_phone || "";
    if (!cleanPhone(handlerPhone) && requestRow.assigned_handler_user_id) {
      const [{ data: emp }, { data: prof }] = await Promise.all([
        db.from("employee_profiles").select("mobile_number, work_number").eq("user_id", requestRow.assigned_handler_user_id).maybeSingle(),
        db.from("profiles").select("phone").eq("user_id", requestRow.assigned_handler_user_id).maybeSingle(),
      ]);
      handlerPhone = emp?.work_number || emp?.mobile_number || prof?.phone || "";
    }
    await sendTemplate("pgdm_certificate_approved_handler", handlerPhone, [
      requestRow.assigned_handler_name || "Team member",
      requestRow.request_number,
      requestRow.alumni_name,
      link,
    ]);
  }

  if (body.event === "ready_for_collection") {
    // Notify the candidate on both channels that the printed diploma is ready.
    await sendTemplate("pgdm_diploma_ready_student", requestRow.contact_phone_spoc || requestRow.requestor_phone, [
      requestRow.alumni_name,
      requestRow.request_number,
      requestRow.assigned_handler_name || "Student Services Team",
      // Meta rejects empty template params, so fall back to the Student
      // Services desk number when no handler phone is on record.
      requestRow.assigned_handler_official_phone || "+91-7428477664",
    ]);

    if (requestRow.contact_email) {
      const name = requestRow.contact_name || requestRow.alumni_name || "Student";
      const handler = requestRow.assigned_handler_name || "Student Services Team";
      const handlerPhone = requestRow.assigned_handler_official_phone || "";
      const subject = `Your PGDM Diploma is ready for collection — ${requestRow.request_number}`;
      const html = `<div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 24px; color: #222; line-height: 1.6;">
        <p>Dear ${name},</p>
        <p>We are pleased to inform you that your <strong>Post Graduate Diploma in Management (PGDM)</strong> certificate (Request ${requestRow.request_number}) has been approved and printed.</p>
        <p>It is now <strong>ready for collection</strong> at NIMT Educational Institutions. Please carry a valid photo ID when you visit.</p>
        <p>For any assistance, please contact ${handler}${handlerPhone ? ` at ${handlerPhone}` : ""}.</p>
        <p style="margin-top: 24px;">Warm regards,<br/>Student Services<br/>NIMT Educational Institutions</p>
      </div>`;
      await sendEmail(requestRow.contact_email, subject, html);
    }
  }

  return json({
    ok: true,
    event: body.event,
    request_id: body.request_id,
    whatsapp_sends: sends,
    email_send: emailSend,
  });
});
