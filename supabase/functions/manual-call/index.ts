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
import { maskPhoneForLog, normalizePlivoVoiceNumber, normalizePlivoVoiceNumbers } from "../_shared/phone.ts";

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
    const PLIVO_DIALER_PHONE_NUMBERS = Deno.env.get("PLIVO_DIALER_PHONE_NUMBERS");
    const VOICE_AGENT_URL = Deno.env.get("VOICE_AGENT_URL");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const dialerNumberSecret = PLIVO_DIALER_PHONE_NUMBERS || PLIVO_DIALER_PHONE_NUMBER;

    if (!PLIVO_AUTH_ID || !PLIVO_AUTH_TOKEN || !dialerNumberSecret || !VOICE_AGENT_URL) {
      return json({ error: "Calling not configured. Contact admin." }, 503);
    }

    const dialerNumbers = normalizePlivoVoiceNumbers(dialerNumberSecret);
    if (dialerNumbers.length === 0) {
      console.error("Invalid PLIVO_DIALER_PHONE_NUMBER(S) for voice calls:", maskPhoneForLog(dialerNumberSecret));
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

    const { count: manualCallCount, error: manualCallCountErr } = await db
      .from("ai_call_records")
      .select("id", { count: "exact", head: true })
      .eq("call_type", "manual");
    if (manualCallCountErr) {
      console.warn("Could not read manual call count for Plivo caller ID rotation:", manualCallCountErr);
    }
    const dialerRotationIndex = manualCallCountErr
      ? Math.floor(Date.now() / 1000)
      : manualCallCount || 0;
    const dialerFrom = dialerNumbers[dialerRotationIndex % dialerNumbers.length];

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

    const failCallSetup = async (summary: string, error: string, status = 502) => {
      await db
        .from("ai_call_records")
        .update({
          status: "failed",
          disposition: "call_setup_failed",
          duration_seconds: 0,
          completed_at: new Date().toISOString(),
          summary,
        } as any)
        .eq("call_uuid", callId);
      return json({ error }, status);
    };

    // Set bridge context on voice agent server
    let ctxRes: Response;
    try {
      ctxRes = await fetch(`${VOICE_AGENT_URL}/bridge-context/${callId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leadId: lead_id,
          leadName: lead.name,
          courseName: (lead.courses as any)?.name || null,
          campusName: (lead.campuses as any)?.name || null,
          counsellorPhone,
          studentPhone,
          dialerFrom,
          counsellorName: profile.display_name,
          counsellorUserId: userId,
        }),
      });
    } catch (err: any) {
      console.error("Bridge context request failed:", err);
      return await failCallSetup(
        `Cloud Call failed before provider dial: bridge context request failed: ${err?.message || "network error"}`,
        "Call setup failed before dialing your phone. Try again.",
      );
    }

    if (!ctxRes.ok) {
      const ctxText = await ctxRes.text().catch(() => "");
      console.error("Bridge context setup failed:", ctxRes.status, ctxText);
      return await failCallSetup(
        "Cloud Call failed before provider dial: bridge context setup failed",
        "Call setup failed before dialing your phone. Try again.",
      );
    }

    // Plivo: call the counsellor first
    const answerUrl = `${VOICE_AGENT_URL}/bridge-answer/${callId}?student=${encodeURIComponent(studentPhone)}&caller=${encodeURIComponent(dialerFrom)}`;
    const plivoUrl = `https://api.plivo.com/v1/Account/${PLIVO_AUTH_ID}/Call/`;

    const hangupUrl = `${VOICE_AGENT_URL}/bridge-hangup/${callId}`;
    const stateCallbackUrl = `${VOICE_AGENT_URL}/bridge-call-status/${callId}`;

    const plivoPayload = {
      from: dialerFrom,
      to: counsellorPhone,
      answer_url: answerUrl,
      answer_method: "GET",
      ring_url: stateCallbackUrl,
      ring_method: "POST",
      hangup_url: hangupUrl,
      hangup_method: "POST",
      ring_timeout: 30,
      caller_name: `NIMT CRM: ${lead.name || "Lead"}`,
    };

    let plivoRes: Response;
    try {
      plivoRes = await fetch(plivoUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Basic " + btoa(`${PLIVO_AUTH_ID}:${PLIVO_AUTH_TOKEN}`),
        },
        body: JSON.stringify(plivoPayload),
      });
    } catch (err: any) {
      console.error("Plivo call request failed before provider accepted call:", err);
      return await failCallSetup(
        `Cloud Call failed before ringing counsellor: Plivo request failed: ${err?.message || "network error"}`,
        "Call failed before reaching Plivo. Try again.",
        500,
      );
    }

    const plivoText = await plivoRes.text();
    let plivoData: any = {};
    try { plivoData = JSON.parse(plivoText); } catch { plivoData = { raw: plivoText }; }
    const rawRequestUuid = plivoData.request_uuid;
    const requestUuid = Array.isArray(rawRequestUuid) ? rawRequestUuid[0] : rawRequestUuid;

    console.log("Plivo response:", plivoRes.status, plivoText);
    console.log("Plivo payload sent:", JSON.stringify({
      ...plivoPayload,
      from: maskPhoneForLog(dialerFrom),
      to: maskPhoneForLog(counsellorPhone),
      dialer_rotation_index: dialerRotationIndex,
      dialer_pool_size: dialerNumbers.length,
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

    // Patch the provider request identifier returned by Call.create when
    // present. Some Plivo accounts return only "async api spawned"; in that
    // case the ring/answer/hangup webhooks below persist the real CallUUID.
    const callRecordPatch: Record<string, unknown> = {
      summary: requestUuid
        ? `Cloud Call: connecting by ${profile.display_name}`
        : `Cloud Call: accepted by Plivo; waiting for counsellor leg callback for ${profile.display_name}`,
    };
    if (requestUuid) callRecordPatch.plivo_call_uuid = requestUuid;
    await db
      .from("ai_call_records")
      .update(callRecordPatch as any)
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
      plivo_request_uuid: requestUuid || null,
      message: `Calling your phone (${profile.phone})... Pick up to connect to ${lead.name || "the student"}.`,
    });
  } catch (err: any) {
    console.error("Manual call error:", err);
    return json({ error: err.message }, 500);
  }
});
