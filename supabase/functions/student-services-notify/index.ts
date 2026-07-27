import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CRM_BASE = Deno.env.get("CRM_BASE") || "https://uni.nimt.ac.in";

type NotifyEvent = "assigned" | "manual" | "unassigned";

interface NotifyBody {
  request_id: string;
  event?: NotifyEvent;
}

const serviceLabels: Record<string, string> = {
  verification: "Student Verification",
  marksheet: "Marksheet Request",
  diploma: "Degree/Diploma Request",
  transcript: "Transcript Request",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

function requireServiceRole(req: Request, serviceRoleKey: string): boolean {
  const auth = req.headers.get("authorization") || "";
  if (!auth.startsWith("Bearer ")) return false;
  const token = auth.slice(7);
  if (serviceRoleKey && token === serviceRoleKey) return true;
  try {
    const [, payloadB64] = token.split(".");
    if (!payloadB64) return false;
    const payload = JSON.parse(atob(payloadB64.replace(/-/g, "+").replace(/_/g, "/")));
    return payload?.role === "service_role";
  } catch {
    return false;
  }
}

function requestLink(requestId: string) {
  return `${CRM_BASE}/alumni-verifications?request=${encodeURIComponent(requestId)}`;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  if (!requireServiceRole(req, serviceRoleKey)) return json({ error: "unauthorized" }, 401);

  let body: NotifyBody;
  try {
    body = await req.json();
  } catch {
    return json({ error: "invalid json" }, 400);
  }

  if (!body.request_id) return json({ error: "request_id required" }, 400);

  const db = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
  const { data: requestRow, error } = await db
    .from("alumni_verification_requests")
    .select("id, request_number, request_type, alumni_name, course, year_of_passing, due_date, assigned_handler_user_id, assigned_handler_name, assigned_handler_email, assigned_handler_official_phone, assignment_status")
    .eq("id", body.request_id)
    .maybeSingle();

  if (error || !requestRow) return json({ error: "request not found" }, 404);

  const event = body.event || "assigned";
  if (event === "unassigned" || !requestRow.assigned_handler_user_id) {
    return json({ ok: true, skipped: "no assigned handler" });
  }

  const serviceName = serviceLabels[requestRow.request_type || "verification"] || "Student Services";
  const dueText = requestRow.due_date ? new Date(requestRow.due_date).toLocaleDateString("en-IN") : "as per TAT";
  const link = requestLink(requestRow.id);
  const handlerName = requestRow.assigned_handler_name || "Team member";

  let emailSent = false;
  if (requestRow.assigned_handler_email) {
    const html = `
      <div style="font-family:Arial,sans-serif;max-width:640px;margin:0 auto;padding:24px">
        <h2 style="margin:0 0 12px;color:#0f172a">Student Services request assigned</h2>
        <p>Dear ${handlerName},</p>
        <p>You have been assigned a Student Services request with TAT.</p>
        <table style="width:100%;border-collapse:collapse;margin:16px 0">
          <tr><td style="padding:8px;border:1px solid #ddd">Request</td><td style="padding:8px;border:1px solid #ddd"><strong>${requestRow.request_number}</strong></td></tr>
          <tr><td style="padding:8px;border:1px solid #ddd">Service</td><td style="padding:8px;border:1px solid #ddd">${serviceName}</td></tr>
          <tr><td style="padding:8px;border:1px solid #ddd">Student</td><td style="padding:8px;border:1px solid #ddd">${requestRow.alumni_name}</td></tr>
          <tr><td style="padding:8px;border:1px solid #ddd">Course / Batch</td><td style="padding:8px;border:1px solid #ddd">${requestRow.course} / ${requestRow.year_of_passing}</td></tr>
          <tr><td style="padding:8px;border:1px solid #ddd">Due date</td><td style="padding:8px;border:1px solid #ddd">${dueText}</td></tr>
        </table>
        <p><a href="${link}" style="color:#0047ff">Open request in admin panel</a></p>
      </div>`;

    try {
      const res = await fetch(`${supabaseUrl}/functions/v1/send-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceRoleKey}` },
        body: JSON.stringify({
          to_email: requestRow.assigned_handler_email,
          custom_subject: `Student Services TAT assigned - ${requestRow.request_number}`,
          custom_body: html,
        }),
      });
      emailSent = res.ok;
      if (!res.ok) console.error("[student-services-notify] email failed:", await res.text().catch(() => ""));
    } catch (e) {
      console.error("[student-services-notify] email error:", e);
    }
  }

  let whatsappSent = false;
  if (requestRow.assigned_handler_official_phone) {
    try {
      const res = await fetch(`${supabaseUrl}/functions/v1/whatsapp-send`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceRoleKey}` },
        body: JSON.stringify({
          template_key: "student_services_tat",
          phone: requestRow.assigned_handler_official_phone,
          params: [
            handlerName,
            requestRow.request_number,
            serviceName,
            requestRow.alumni_name,
            `${requestRow.course} (${requestRow.year_of_passing})`,
            dueText,
          ],
        }),
      });
      whatsappSent = res.ok;
      if (!res.ok) console.error("[student-services-notify] WhatsApp failed:", await res.text().catch(() => ""));
    } catch (e) {
      console.error("[student-services-notify] WhatsApp error:", e);
    }
  }

  return json({
    ok: true,
    request_id: body.request_id,
    event,
    email_sent: emailSent,
    whatsapp_sent_to_official_number: whatsappSent,
  });
});
