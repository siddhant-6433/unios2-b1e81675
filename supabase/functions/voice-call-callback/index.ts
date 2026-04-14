/**
 * Voice Call Callback
 *
 * Handles:
 * 1. Plivo recording callback (form-urlencoded)
 * 2. Voice agent hangup callback (JSON with lead_id + summary)
 * 3. Manual trigger to fetch recording from Plivo API (JSON with call_uuid)
 *
 * When called, also proactively fetches recordings from Plivo for any
 * AI-called leads that are missing recordings.
 */

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

async function fetchPlivoRecording(callUuid: string, authId: string, authToken: string): Promise<{ url: string; duration: number } | null> {
  try {
    // Plivo recordings API — get recordings for a specific call
    const res = await fetch(
      `https://api.plivo.com/v1/Account/${authId}/Recording/?call_uuid=${callUuid}&limit=1`,
      { headers: { Authorization: "Basic " + btoa(`${authId}:${authToken}`) } }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const rec = data?.objects?.[0];
    if (rec?.recording_url) {
      return { url: rec.recording_url, duration: parseInt(rec.recording_duration_ms || "0") / 1000 };
    }

    // Also try getting call detail which may have recording
    const callRes = await fetch(
      `https://api.plivo.com/v1/Account/${authId}/Call/${callUuid}/`,
      { headers: { Authorization: "Basic " + btoa(`${authId}:${authToken}`) } }
    );
    if (!callRes.ok) return null;
    const callData = await callRes.json();
    if (callData?.recording_url) {
      return {
        url: callData.recording_url,
        duration: parseInt(callData.bill_duration || callData.duration || "0"),
      };
    }
    return null;
  } catch (e) {
    console.error("Plivo recording fetch error:", e);
    return null;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const PLIVO_AUTH_ID = Deno.env.get("PLIVO_AUTH_ID") || "";
    const PLIVO_AUTH_TOKEN = Deno.env.get("PLIVO_AUTH_TOKEN") || "";
    const db = createClient(supabaseUrl, serviceRoleKey);

    const contentType = req.headers.get("content-type") || "";

    // ── PLIVO CALLBACK (form-urlencoded) ──
    if (contentType.includes("form-urlencoded")) {
      const formData = await req.formData();
      const params: Record<string, string> = {};
      formData.forEach((v, k) => { params[k] = String(v); });
      console.log("Plivo callback:", JSON.stringify(params));

      const recordUrl = params.RecordUrl || params.record_url || "";
      const duration = parseInt(params.RecordingDuration || params.recording_duration || "0");
      const callUuid = params.CallUUID || params.call_uuid || "";

      if (recordUrl && callUuid) {
        const { data: lead } = await db.from("leads").select("id, name")
          .eq("ai_call_uuid", callUuid).maybeSingle();
        if (lead) {
          await db.from("leads").update({
            ai_recording_url: recordUrl,
            ai_call_duration_seconds: duration,
          } as any).eq("id", lead.id);
          await db.from("lead_notes").insert({
            lead_id: lead.id,
            content: `🎙️ AI Call Recording (${Math.floor(duration / 60)}m ${duration % 60}s):\n${recordUrl}`,
          });
        }
      }
      return new Response("OK", { status: 200 });
    }

    // ── JSON CALLBACK ──
    const body = await req.json().catch(() => ({}));

    // If lead_id provided with summary/transcript — store directly
    if (body.lead_id) {
      const updates: Record<string, any> = {};
      if (body.transcript) updates.ai_transcript = body.transcript;
      if (body.summary) updates.ai_notes = body.summary;
      if (body.recording_url) updates.ai_recording_url = body.recording_url;
      if (body.duration_seconds) updates.ai_call_duration_seconds = body.duration_seconds;
      if (body.conversion_probability !== undefined) updates.ai_conversion_probability = body.conversion_probability;

      if (Object.keys(updates).length > 0) {
        await db.from("leads").update(updates).eq("id", body.lead_id);
      }

      if (body.summary) {
        await db.from("lead_activities").insert({
          lead_id: body.lead_id, type: "ai_call",
          description: `AI call completed. ${body.summary}${body.conversion_probability !== undefined ? ` Conversion: ${body.conversion_probability}%` : ""}`,
        });
        await db.from("lead_notes").insert({
          lead_id: body.lead_id,
          content: `🤖 AI Call Summary:\n${body.summary}${body.recording_url ? `\n\n🔗 Recording: ${body.recording_url}` : ""}`,
        });
      }
    }

    // ── PROACTIVE: Fetch recordings from Plivo for recent AI calls missing recordings ──
    if (PLIVO_AUTH_ID && PLIVO_AUTH_TOKEN) {
      // Check ai_call_records table for calls without recordings
      const { data: pendingCalls } = await db
        .from("ai_call_records")
        .select("id, lead_id, call_uuid, plivo_call_uuid")
        .is("recording_url", null)
        .in("status", ["initiated", "completed", "in_progress"])
        .gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
        .order("created_at", { ascending: false })
        .limit(10);

      for (const call of pendingCalls || []) {
        const uuid = call.plivo_call_uuid || call.call_uuid;
        if (!uuid) continue;
        const recording = await fetchPlivoRecording(uuid, PLIVO_AUTH_ID, PLIVO_AUTH_TOKEN);
        if (recording) {
          // Update the specific call record
          await db.from("ai_call_records").update({
            recording_url: recording.url,
            duration_seconds: Math.round(recording.duration),
            status: "completed",
            completed_at: new Date().toISOString(),
          }).eq("id", call.id);

          // Also update the lead-level fields (latest recording)
          await db.from("leads").update({
            ai_recording_url: recording.url,
            ai_call_duration_seconds: Math.round(recording.duration),
          } as any).eq("id", call.lead_id);

          // Add note
          await db.from("lead_notes").insert({
            lead_id: call.lead_id,
            content: `🎙️ AI Call Recording (${Math.floor(recording.duration / 60)}m ${Math.round(recording.duration % 60)}s):\n${recording.url}`,
          });
          console.log(`Recording stored for call ${call.id}: ${recording.url}`);
        }
      }
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("voice-call-callback error:", err);
    return new Response("OK", { status: 200 });
  }
});
