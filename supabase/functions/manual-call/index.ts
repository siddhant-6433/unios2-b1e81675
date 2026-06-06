/**
 * Edge Function: manual-call
 *
 * Initiates a bridge call: Plivo calls the counsellor's phone first,
 * when they answer, bridges to the student's number.
 *
 * Request: { lead_id: string }
 * Auth: Requires authenticated user (counsellor or admin)
 *
 * Flow:
 * 1. Fetch lead phone + counsellor phone from profiles
 * 2. Set bridge context on voice agent server
 * 3. Plivo calls counsellor → answer_url bridges to student
 * 4. Call recorded, logged as lead_activity
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import { maskPhoneForLog, normalizePlivoVoiceNumber } from "../_shared/phone.ts";

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
    // Cloud-dialer caller-id — separate from the AI agent's number so leads
    // can tell whether they're being called by an AI vs a human counsellor.
    const PLIVO_DIALER_PHONE_NUMBER = Deno.env.get("PLIVO_DIALER_PHONE_NUMBER");
    const VOICE_AGENT_URL = Deno.env.get("VOICE_AGENT_URL");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    if (!PLIVO_AUTH_ID || !PLIVO_AUTH_TOKEN || !PLIVO_DIALER_PHONE_NUMBER || !VOICE_AGENT_URL) {
      return json({ error: "Calling not configured. Contact admin." }, 503);
    }

    const dialerFrom = normalizePlivoVoiceNumber(PLIVO_DIALER_PHONE_NUMBER);
    if (!dialerFrom) {
      console.error("Invalid PLIVO_DIALER_PHONE_NUMBER for voice calls:", maskPhoneForLog(PLIVO_DIALER_PHONE_NUMBER));
      return json({ error: "Calling number is not configured correctly. Contact admin." }, 503);
    }

    // Auth: accept anon key (manual button) or service role (internal).
    // User identity passed as caller_user_id in body for audit.
    const authHeader = req.headers.get("authorization") || "";
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const db = createClient(supabaseUrl, serviceRoleKey);
    const { lead_id, caller_user_id } = await req.json();
    if (!lead_id) return json({ error: "lead_id required" }, 400);

    const userId = caller_user_id || null;

    // Fetch lead
    const { data: lead, error: leadErr } = await db
      .from("leads")
      .select("id, name, phone, stage, courses:course_id(name), campuses:campus_id(name)")
      .eq("id", lead_id)
      .single();

    if (leadErr || !lead) return json({ error: "Lead not found" }, 404);
    if (!lead.phone) return json({ error: "Lead has no phone number" }, 400);
    if (lead.stage === "dnc") return json({ error: "Lead is DNC — call blocked" }, 403);

    // Fetch counsellor's phone from profile
    if (!userId) return json({ error: "caller_user_id required" }, 400);

    const { data: profile } = await db
      .from("profiles")
      .select("phone, display_name")
      .eq("user_id", userId)
      .single();

    if (!profile?.phone) {
      return json({ error: "Your phone number is not set in your profile. Go to Settings → Profile to add it." }, 400);
    }

    const studentPhone = normalizePlivoVoiceNumber(lead.phone);
    if (!studentPhone) {
      return json({ error: "Lead phone number is not valid for calling. Update the lead phone and try again." }, 400);
    }

    const counsellorPhone = normalizePlivoVoiceNumber(profile.phone);
    if (!counsellorPhone) {
      return json({ error: "Your profile phone number is not valid for calling. Use a 10-digit Indian mobile number with country code +91." }, 400);
    }

    const callId = crypto.randomUUID();

    // Create the live-call row before touching Plivo. Plivo can emit status /
    // hangup callbacks before Call.create returns; if the row does not exist
    // yet, those callbacks patch zero rows and the later insert leaves a
    // permanent status='initiated' call in the LiveCallBar.
    const { error: callRecordErr } = await db.from("ai_call_records").insert({
      lead_id,
      call_uuid: callId,
      status: "initiated",
      call_type: "manual",
      caller_user_id: userId,
      summary: `Cloud Call: dialing counsellor ${profile.display_name}`,
    });

    if (callRecordErr) {
      console.error("Failed to create manual call record:", callRecordErr);
      return json({ error: "Could not start call tracking. Try again." }, 500);
    }

    // Set bridge context on voice agent server
    const ctxRes = await fetch(`${VOICE_AGENT_URL}/bridge-context/${callId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        leadId: lead_id,
        leadName: lead.name,
        courseName: (lead.courses as any)?.name || null,
        campusName: (lead.campuses as any)?.name || null,
        counsellorPhone,
        studentPhone,
        counsellorName: profile.display_name,
        counsellorUserId: userId,
      }),
    });

    if (!ctxRes.ok) {
      const ctxText = await ctxRes.text().catch(() => "");
      console.error("Bridge context setup failed:", ctxRes.status, ctxText);
      await db
        .from("ai_call_records")
        .update({
          status: "failed",
          disposition: "call_setup_failed",
          duration_seconds: 0,
          completed_at: new Date().toISOString(),
          summary: "Cloud Call failed before provider dial: bridge context setup failed",
        } as any)
        .eq("call_uuid", callId);
      return json({ error: "Call setup failed before dialing your phone. Try again." }, 502);
    }

    // Plivo: call the counsellor first
    const answerUrl = `${VOICE_AGENT_URL}/bridge-answer/${callId}?student=${studentPhone}`;
    const plivoUrl = `https://api.plivo.com/v1/Account/${PLIVO_AUTH_ID}/Call/`;

    const hangupUrl = `${VOICE_AGENT_URL}/bridge-hangup/${callId}`;
    const stateCallbackUrl = `${VOICE_AGENT_URL}/bridge-call-status/${callId}`;

    const plivoPayload = {
      from: dialerFrom,
      to: counsellorPhone,
      answer_url: answerUrl,
      answer_method: "GET",
      hangup_url: hangupUrl,
      hangup_method: "POST",
      // Per-state callback. Plivo POSTs this URL on every CallStatus change
      // (initiated / ringing / in-progress / completed) for the parent
      // counsellor leg. Student connection is detected by the bridged B-leg
      // callback in voice-agent.
      callback_url: stateCallbackUrl,
      callback_method: "POST",
      ring_timeout: 30,
      caller_name: `NIMT CRM: ${lead.name || "Lead"}`,
    };

    const plivoRes = await fetch(plivoUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Basic " + btoa(`${PLIVO_AUTH_ID}:${PLIVO_AUTH_TOKEN}`),
      },
      body: JSON.stringify(plivoPayload),
    });

    const plivoText = await plivoRes.text();
    let plivoData: any = {};
    try { plivoData = JSON.parse(plivoText); } catch { plivoData = { raw: plivoText }; }

    console.log("Plivo response:", plivoRes.status, plivoText);
    console.log("Plivo payload sent:", JSON.stringify({
      ...plivoPayload,
      from: maskPhoneForLog(dialerFrom),
      to: maskPhoneForLog(counsellorPhone),
    }));

    if (!plivoRes.ok) {
      console.error("Plivo call failed:", plivoRes.status, plivoText);
      await db
        .from("ai_call_records")
        .update({
          status: "failed",
          disposition: "call_setup_failed",
          duration_seconds: 0,
          completed_at: new Date().toISOString(),
          summary: `Cloud Call failed before ringing counsellor: ${plivoData?.error || plivoData?.message || plivoText || "Plivo error"}`,
        } as any)
        .eq("call_uuid", callId);
      return json({ error: `Call failed: ${plivoData?.error || plivoData?.message || plivoText || "Unknown error"}` }, 500);
    }

    // Patch any provider identifier Call.create returned. Some Plivo accounts
    // return only "async api spawned"; bridge-call-status will persist the real
    // CallUUID on the first callback in that case.
    await db
      .from("ai_call_records")
      .update({
        plivo_call_uuid: plivoData.request_uuid || null,
        summary: `Cloud Call: connecting by ${profile.display_name}`,
      } as any)
      .eq("call_uuid", callId);

    // Log activity
    await db.from("lead_activities").insert({
      lead_id,
      type: "call",
      description: `Manual call initiated by ${profile.display_name} via CRM`,
    });

    // Add note
    await db.from("lead_notes").insert({
      lead_id,
      content: `📞 ${profile.display_name} initiated manual call via CRM`,
      user_id: userId,
    });

    return json({
      success: true,
      call_id: callId,
      plivo_request_uuid: plivoData.request_uuid,
      message: `Calling your phone (${profile.phone})... Pick up to connect to ${lead.name || "the student"}.`,
    });
  } catch (err: any) {
    console.error("Manual call error:", err);
    return json({ error: err.message }, 500);
  }
});
