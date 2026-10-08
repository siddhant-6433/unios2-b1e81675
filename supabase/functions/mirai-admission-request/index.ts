import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { notifyMiraiAdmissions } from "../_shared/miraiNotifications.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const respond = (body: Record<string, unknown>, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
  if (req.method !== "POST") return respond({ error: "Method not allowed" }, 405);

  try {
    const body = await req.json();
    const leadId = typeof body.lead_id === "string" ? body.lead_id : "";
    const requestType = body.request_type === "call" || body.request_type === "campus_tour" ? body.request_type : null;
    if (!leadId || !requestType) return respond({ error: "A valid lead and request type are required." }, 400);

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !serviceKey) return respond({ error: "Admissions requests are unavailable." }, 503);
    const admin = createClient(supabaseUrl, serviceKey);
    const { data: lead, error: leadError } = await admin.from("leads")
      .select("id, name, phone, email, portal_brand, source")
      .eq("id", leadId)
      .maybeSingle();
    if (leadError || !lead || (lead.portal_brand !== "mirai" && lead.source !== "mirai_website")) {
      return respond({ error: "We could not find this Mirai enquiry." }, 404);
    }

    const details = typeof body.details === "string" ? body.details.trim().slice(0, 1000) : null;
    const { data: request, error: insertError } = await admin.from("mirai_admission_requests").insert({
      lead_id: leadId,
      request_type: requestType,
      preferred_time: typeof body.preferred_time === "string" ? body.preferred_time.slice(0, 120) : null,
      message: details,
    }).select("id").single();
    if (insertError?.code === "23505") {
      return respond({ status: "already_pending" });
    }
    if (insertError) throw insertError;

    const staffEmail = Deno.env.get("MIRAI_ADMISSIONS_EMAIL");
    try {
      await notifyMiraiAdmissions(admin, {
        leadId,
        title: requestType === "call" ? "Mirai call request" : "Mirai campus tour request",
        body: `${lead.name} requested a ${requestType === "call" ? "call" : "campus tour"}.`,
        link: "/admissions",
      });
    } catch (notificationError) {
      console.error("Mirai request in-app notification failed:", notificationError);
    }
    if (staffEmail) {
      const kind = requestType === "call" ? "call" : "campus tour";
      const html = `<p>A parent requested a Mirai ${kind}.</p><p><strong>Child:</strong> ${escapeHtml(String(body.child_name || lead.name))}<br><strong>Parent:</strong> ${escapeHtml(String(body.parent_name || ""))}<br><strong>Phone:</strong> ${escapeHtml(String(lead.phone || ""))}<br><strong>Email:</strong> ${escapeHtml(String(lead.email || ""))}</p><p>Request ID: ${request.id}</p>`;
      const response = await fetch(`${supabaseUrl}/functions/v1/send-email`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
        body: JSON.stringify({ to_email: staffEmail, custom_subject: `Mirai ${kind} request: ${lead.name}`, custom_body: html, lead_id: leadId }),
      });
      if (!response.ok) console.error("Mirai request notification failed:", response.status, await response.text());
    } else {
      console.warn("MIRAI_ADMISSIONS_EMAIL is not configured; the request is saved for admissions staff in UniOs.");
    }

    return respond({ status: "created", request_id: request.id });
  } catch (error) {
    console.error("Mirai admissions request failed:", error);
    return respond({ error: "We could not save your request. Please try again." }, 500);
  }
});

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]!);
}
