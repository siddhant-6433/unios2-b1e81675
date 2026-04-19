/**
 * Edge Function: voice-call
 *
 * Actions:
 *   - outbound: Initiate an AI outbound call to a lead via Plivo
 *   - status:   Check call status
 *
 * Env vars: PLIVO_AUTH_ID, PLIVO_AUTH_TOKEN, PLIVO_PHONE_NUMBER,
 *           VOICE_AGENT_URL (public URL of voice-agent server),
 *           SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
 */

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const PLIVO_AUTH_ID = Deno.env.get("PLIVO_AUTH_ID");
    const PLIVO_AUTH_TOKEN = Deno.env.get("PLIVO_AUTH_TOKEN");
    const PLIVO_PHONE_NUMBER = Deno.env.get("PLIVO_PHONE_NUMBER"); // Your Plivo Indian number
    const VOICE_AGENT_URL = Deno.env.get("VOICE_AGENT_URL"); // e.g. https://voice.nimt.ac.in
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    if (!PLIVO_AUTH_ID || !PLIVO_AUTH_TOKEN || !PLIVO_PHONE_NUMBER || !VOICE_AGENT_URL) {
      return json({ error: "Voice calling not configured. Set PLIVO_AUTH_ID, PLIVO_AUTH_TOKEN, PLIVO_PHONE_NUMBER, VOICE_AGENT_URL." }, 503);
    }

    // Auth: accept service role JWT (cron/queue) OR anon key (manual button).
    // User identity is passed as caller_user_id in the request body for audit.
    const authHeader = req.headers.get("authorization") || "";
    const db = createClient(supabaseUrl, serviceRoleKey);
    const token = authHeader.replace(/^Bearer\s+/i, "");

    // Detect service role by decoding JWT payload
    let isServiceRole = false;
    try {
      const [, payloadB64] = token.split(".");
      if (payloadB64) {
        const payload = JSON.parse(atob(payloadB64.replace(/-/g, "+").replace(/_/g, "/")));
        isServiceRole = payload?.role === "service_role";
      }
    } catch { /* ignore */ }

    // Reject if no auth header at all
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const body = await req.json();
    const { action, lead_id, caller_user_id } = body;

    const user = { id: isServiceRole ? "system" : (caller_user_id || "manual") };

    if (action === "outbound") {
      if (!lead_id) return json({ error: "lead_id required" }, 400);

      // Fetch lead details
      const { data: lead, error: leadErr } = await db
        .from("leads")
        .select("*, courses:course_id(name, code), campuses:campus_id(name)")
        .eq("id", lead_id)
        .single();

      if (leadErr || !lead) return json({ error: "Lead not found" }, 404);
      if (!lead.phone) return json({ error: "Lead has no phone number" }, 400);

      // For automated/queue calls (service role), wait briefly so lead data settles.
      // For manual AI call button (user JWT), call immediately — no delay needed.
      if (isServiceRole) {
        await new Promise(resolve => setTimeout(resolve, 10000)); // 10 seconds
      }

      // Re-fetch lead — name/course may have been updated in the interim
      const { data: refreshedLead } = await db
        .from("leads")
        .select("*, courses:course_id(name, code), campuses:campus_id(name)")
        .eq("id", lead_id)
        .single();

      const activeLead = refreshedLead || lead;

      // Generate a unique call ID
      const callId = crypto.randomUUID();

      // Set call context on the voice agent server
      const contextPayload = {
        direction: "outbound",
        leadId: lead_id,
        leadName: activeLead.name,
        courseName: (activeLead.courses as any)?.name || null,
        courseCode: (activeLead.courses as any)?.code || null,
        campusName: (activeLead.campuses as any)?.name || null,
        leadSource: activeLead.source,
        guardianName: activeLead.guardian_name,
      };

      const ctxRes = await fetch(`${VOICE_AGENT_URL}/context/${callId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(contextPayload),
      });

      if (!ctxRes.ok) {
        console.error("Failed to set call context:", await ctxRes.text());
        return json({ error: "Voice agent server unreachable" }, 503);
      }

      // Initiate call via Plivo API
      const plivoUrl = `https://api.plivo.com/v1/Account/${PLIVO_AUTH_ID}/Call/`;
      const answerUrl = `${VOICE_AGENT_URL}/answer/${callId}`;
      const statusUrl = `${VOICE_AGENT_URL}/status/${callId}`;

      // Normalize phone: ensure starts with country code
      let phone = lead.phone.replace(/[^0-9+]/g, "");
      if (phone.startsWith("+")) phone = phone.substring(1);
      if (phone.length === 10) phone = `91${phone}`; // Indian number

      // Callback URL for recording — points to our voice-call-callback function
      const recordingCallbackUrl = `${supabaseUrl}/functions/v1/voice-call-callback`;

      const plivoPayload: Record<string, any> = {
        from: PLIVO_PHONE_NUMBER,
        to: phone,
        answer_url: answerUrl,
        answer_method: "POST",
        hangup_url: statusUrl,
        hangup_method: "POST",
        time_limit: 600,
        ring_timeout: 30,
      };

      console.log("Plivo call payload:", JSON.stringify({ ...plivoPayload, from: "***", to: phone.slice(-4) }));

      const plivoRes = await fetch(plivoUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Basic " + btoa(`${PLIVO_AUTH_ID}:${PLIVO_AUTH_TOKEN}`),
        },
        body: JSON.stringify(plivoPayload),
      });

      const plivoResult = await plivoRes.json();
      console.log("Plivo response:", JSON.stringify(plivoResult));

      if (!plivoRes.ok) {
        console.error("Plivo call error:", plivoResult);
        return json({ error: plivoResult?.error || "Failed to initiate call" }, 502);
      }

      // Plivo returns request_uuid as string for single call, or array for bulk
      const rawUuid = plivoResult.request_uuid;
      const plivoUuid = Array.isArray(rawUuid) ? rawUuid[0] : (rawUuid || "");

      // Create AI call record
      await db.from("ai_call_records").insert({
        lead_id,
        call_uuid: callId,
        plivo_call_uuid: plivoUuid,
        initiated_by: user.id,
        status: "initiated",
      });

      // Log activity (user_id null for system-initiated calls)
      await db.from("lead_activities").insert({
        lead_id,
        type: "ai_call",
        user_id: isServiceRole ? null : user.id,
        description: `AI voice call ${isServiceRole ? "auto-" : ""}initiated to ${lead.name} (${lead.phone}). Call ID: ${callId}`,
      });

      // Tag lead as AI called
      await db.from("leads").update({
        ai_called: true,
        ai_called_at: new Date().toISOString(),
        ai_call_uuid: plivoUuid || callId,
      } as any).eq("id", lead_id);

      return json({
        success: true,
        call_id: callId,
        plivo_request_uuid: plivoResult.request_uuid,
        message: `Calling ${activeLead.name}...`,
      });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (err: any) {
    console.error("voice-call error:", err);
    return json({ error: err.message }, 500);
  }
});
