/**
 * Edge Function: manual-call-cancel
 *
 * Counsellor pressed "Cancel" on the disposition screen while a Cloud Call
 * was still in flight. We need to:
 *   1. Hang up the live Plivo call so both legs (counsellor + student) drop.
 *      Hanging up the parent A-leg automatically tears down the bridged B-leg.
 *   2. Record the disposition as `cancelled_by_counsellor` so the timeline
 *      distinguishes "counsellor abandoned the call" from "student never
 *      answered" (the latter is what bridge-hangup writes as `cancelled`).
 *
 * Request: { call_id: string, caller_user_id?: string, hangup_only?: boolean }
 *   call_id      — the internal call_uuid created by manual-call
 *   hangup_only  — when true (counsellor pressed "End Call" on a CONNECTED
 *                  call), only drop the live Plivo legs and skip the
 *                  cancelled_by_counsellor disposition/timeline writes. The
 *                  call was answered, so a real disposition follows from the
 *                  UI and bridge-hangup will reconcile ai_call_records.
 *
 * Idempotent: safe to call multiple times. Plivo returns 404 if the call
 * already ended; we treat that as success. record_cloud_call_log dedupes on
 * cloud_call_uuid + first-write-wins for the manual disposition.
 */

import { createClient } from "npm:@supabase/supabase-js@2";
import { normalizePlivoVoiceNumber } from "../_shared/phone.ts";

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
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    if (!PLIVO_AUTH_ID || !PLIVO_AUTH_TOKEN) {
      return json({ error: "Plivo not configured. Contact admin." }, 503);
    }

    const authHeader = req.headers.get("authorization") || "";
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const { call_id, caller_user_id, hangup_only } = await req.json();
    if (!call_id) return json({ error: "call_id required" }, 400);

    const db = createClient(supabaseUrl, serviceRoleKey);

    // Resolve the Plivo CallUUID + lead context from the ai_call_records row
    // that manual-call inserted at call placement time. The plivo_call_uuid
    // is NOT populated by manual-call (Plivo returns "async api spawned" with
    // no request_uuid for our account) — instead voice-agent's bridge-call-status
    // webhook persists it on the first Plivo state callback (~200ms after
    // placement). If the user clicks Cancel faster than that, the value is
    // still null on first read, so we retry briefly before giving up.
    const fetchRecord = async () =>
      await db
        .from("ai_call_records")
        .select("id, lead_id, plivo_call_uuid, caller_user_id, status")
        .eq("call_uuid", call_id)
        .eq("call_type", "manual")
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();

    let { data: record, error: recErr } = await fetchRecord();
    if (recErr || !record) return json({ error: "Call record not found" }, 404);

    // Wait up to 2 seconds (4 × 500ms) for the webhook to write plivo_call_uuid
    // if it hasn't arrived yet. Bail early as soon as we have a value.
    for (let attempt = 0; attempt < 4 && !record.plivo_call_uuid; attempt++) {
      await new Promise((r) => setTimeout(r, 500));
      const retry = await fetchRecord();
      if (retry.data) record = retry.data;
    }

    // Hang up the parent Plivo call. Two complications:
    //
    //   1. Plivo's "Make Call" API returns "async api spawned" with NO
    //      request_uuid for our account — so manual-call has nothing to
    //      store as plivo_call_uuid at placement time. We must look up the
    //      live call ourselves via Plivo's Live Calls API.
    //   2. Plivo splits hangup into two endpoints depending on state:
    //        - DELETE /Request/{request_uuid}/  → queued/ringing
    //        - DELETE /Call/{call_uuid}/        → in-progress
    //      We try both on every uuid we find.
    //
    // Hangup the parent ends the bridged B-leg (student) automatically.
    const auth = btoa(`${PLIVO_AUTH_ID}:${PLIVO_AUTH_TOKEN}`);
    const hangupResults: Record<string, { status: number; body?: string }> = {};
    const uuidsToHangup = new Set<string>();
    if (record.plivo_call_uuid) uuidsToHangup.add(record.plivo_call_uuid);

    // Discover live CallUUIDs for THIS counsellor's leg. Plivo's Make Call API
    // doesn't return a request_uuid for our account (returns "async api spawned"
    // instead), so we have no identifier from placement time. Workaround:
    //   1. Look up the counsellor's phone via caller_user_id → profiles
    //   2. Query Plivo's Live Calls API (?status=live) filtered by to_number
    //      so we only get THIS counsellor's currently-ringing/connected leg
    //   3. Hang up every live UUID matching that filter
    try {
      let counsellorPhone = "";
      if (record.caller_user_id) {
        const { data: prof } = await db
          .from("profiles")
          .select("phone")
          .eq("user_id", record.caller_user_id)
          .single();
        if (prof?.phone) counsellorPhone = normalizePlivoVoiceNumber(prof.phone) || "";
      }

      // Plivo Live Calls endpoint: GET .../Call/?status=live[&to_number=...]
      // Without status=live you get historical CDRs (2574 rows in our case).
      const qs = new URLSearchParams({ status: "live" });
      if (counsellorPhone) qs.set("to_number", counsellorPhone);
      const liveUrl = `https://api.plivo.com/v1/Account/${PLIVO_AUTH_ID}/Call/?${qs.toString()}`;
      const liveRes = await fetch(liveUrl, {
        method: "GET",
        headers: { Authorization: `Basic ${auth}` },
      });
      const liveBody = await liveRes.text().catch(() => "");
      console.log(`[manual-call-cancel ${call_id}] live calls lookup url=${liveUrl} status=${liveRes.status} body=${liveBody.slice(0, 400)}`);
      hangupResults["live_lookup"] = { status: liveRes.status, body: liveBody.slice(0, 500) };
      if (liveRes.ok) {
        const parsed = JSON.parse(liveBody);
        // Plivo's live-calls response: { api_id, calls: ["uuid", ...] }
        const calls = Array.isArray(parsed?.calls) ? parsed.calls : [];
        for (const u of calls) if (typeof u === "string") uuidsToHangup.add(u);
      }
    } catch (e: any) {
      console.error(`[manual-call-cancel ${call_id}] live calls lookup threw:`, e.message);
      hangupResults["live_lookup"] = { status: -1, body: e.message };
    }

    // Now fire DELETEs across every candidate UUID against both endpoints.
    for (const uuid of uuidsToHangup) {
      const endpoints: Array<["request" | "call", string]> = [
        ["request", `https://api.plivo.com/v1/Account/${PLIVO_AUTH_ID}/Request/${uuid}/`],
        ["call",    `https://api.plivo.com/v1/Account/${PLIVO_AUTH_ID}/Call/${uuid}/`],
      ];
      await Promise.all(endpoints.map(async ([label, url]) => {
        try {
          const res = await fetch(url, {
            method: "DELETE",
            headers: { Authorization: `Basic ${auth}` },
          });
          const body = await res.text().catch(() => "");
          hangupResults[`${label}:${uuid.slice(0, 8)}`] = { status: res.status, body: body.slice(0, 200) };
          console.log(`[manual-call-cancel ${call_id}] ${label} uuid=${uuid.slice(0, 8)} status=${res.status}`);
        } catch (e: any) {
          hangupResults[`${label}:${uuid.slice(0, 8)}`] = { status: -1, body: e.message };
        }
      }));
    }

    if (uuidsToHangup.size === 0) {
      console.warn(`[manual-call-cancel ${call_id}] No candidate UUIDs — Plivo hangup skipped`);
    }

    // hangup_only: the call was connected and the counsellor pressed "End Call".
    // We've dropped the Plivo legs above — but the disposition is owned by the
    // UI (a real outcome follows) and bridge-hangup will reconcile the
    // ai_call_records row, so skip all the cancelled_by_counsellor bookkeeping.
    if (hangup_only) {
      return json({ success: true, hangup_only: true });
    }

    // Record cancelled_by_counsellor as a manual disposition. p_source='manual'
    // means the later bridge-hangup auto callback won't overwrite it (the RPC
    // applies first-write-wins via COALESCE on the existing disposition).
    await db.rpc("record_cloud_call_log", {
      p_call_uuid:     call_id,
      p_lead_id:       record.lead_id,
      p_user_id:       caller_user_id || record.caller_user_id,
      p_disposition:   "cancelled_by_counsellor",
      p_duration:      0,
      p_notes:         "Cloud Call cancelled by counsellor from disposition screen",
      p_source:        "manual",
      p_recording_url: null,
      p_call_source:   "manual_log",
    });

    // Terminate the ai_call_records row so the lead-page poll stops spinning
    // on "calling". bridge-hangup may still fire and overwrite some fields,
    // but the lead-page UI keys off this row's status to close the dialog.
    await db
      .from("ai_call_records")
      .update({
        status: "failed",
        disposition: "cancelled_by_counsellor",
        completed_at: new Date().toISOString(),
      } as any)
      .eq("id", record.id);

    // Timeline entry so the cancel is visible alongside other call activity.
    await db.from("lead_activities").insert({
      lead_id: record.lead_id,
      type: "call",
      description: "Cloud Call cancelled by counsellor",
    } as any);

    return json({ success: true });
  } catch (err: any) {
    console.error("manual-call-cancel error:", err);
    return json({ error: err.message }, 500);
  }
});
