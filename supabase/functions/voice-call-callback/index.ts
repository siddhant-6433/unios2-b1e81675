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

// ── Transcribe + Summarize recording using Google Gemini directly ──
// Uses generativelanguage.googleapis.com — native audio support, no gateway.
async function transcribeAndSummarize(recordingUrl: string, googleApiKey: string): Promise<{
  transcript: string | null;
  summary: string | null;
  conversionProb: number | null;
  disposition: string | null;
} | null> {
  try {
    // Download the recording
    const audioRes = await fetch(recordingUrl);
    if (!audioRes.ok) { console.error("Failed to download recording:", audioRes.status); return null; }
    const audioBuffer = await audioRes.arrayBuffer();
    // Use standard base64 encoding (works in Deno)
    const { encode } = await import("https://deno.land/std@0.208.0/encoding/base64.ts");
    const base64Audio = encode(new Uint8Array(audioBuffer));

    console.log(`Processing ${(audioBuffer.byteLength / 1024).toFixed(0)}KB audio via Gemini direct API...`);

    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${googleApiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{
            parts: [
              {
                text: `You are an admissions CRM assistant for NIMT Educational Institutions.
This is a phone call recording between an AI voice agent and a prospective student/parent.

Provide a JSON response with:
1. "transcript": Full verbatim transcript in the original language (Hindi/English/Hinglish). Use [Agent] and [Lead] speaker labels.
2. "summary": 2-4 sentence summary of the call outcome in English — what was discussed, interest level, key points.
3. "conversion_probability": 0-100 integer — how likely this lead is to enroll.
4. "disposition": One of: interested, callback_requested, not_interested, no_answer, busy, wrong_number, voicemail, partial_conversation

Respond ONLY in valid JSON.`
              },
              {
                inlineData: {
                  mimeType: "audio/mp3",
                  data: base64Audio,
                }
              }
            ]
          }],
          generationConfig: {
            responseMimeType: "application/json",
          },
        }),
      }
    );

    if (!res.ok) {
      const errText = await res.text();
      console.error("Gemini API error:", res.status, errText);
      return null;
    }

    const data = await res.json();
    const content = data.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!content) { console.error("No content in Gemini response:", JSON.stringify(data).slice(0, 500)); return null; }

    const jsonStr = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
    const parsed = JSON.parse(jsonStr);

    console.log(`Gemini transcription done: ${(parsed.transcript || "").length} chars, disposition: ${parsed.disposition}`);
    return {
      transcript: parsed.transcript || null,
      summary: parsed.summary || null,
      conversionProb: typeof parsed.conversion_probability === "number" ? parsed.conversion_probability : null,
      disposition: parsed.disposition || null,
    };
  } catch (e) {
    console.error("Gemini transcribe+summarize error:", e);
    return null;
  }
}

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

/**
 * Auto-assign a counsellor to an unassigned lead using team-based round-robin.
 * Resolves the correct team from the lead's course department / campus:
 *   - Mirai campus → Mirai Admissions
 *   - Beacon/NSAE campus → NSAE II Admissions
 *   - Education dept (B.Ed, D.El.Ed) → Grn BEd Admissions
 *   - Law dept (BA LLB, LLB) → Grn Law Admissions
 *   - Management dept (BBA, MBA, PGDM) → Grn Mgmt Faculty Admissions
 *   - Everything else → Grn Counselling
 * Then round-robins within the team (fewest active leads first).
 */
async function autoAssignCounsellor(
  db: any,
  leadId: string,
  disposition: string | null,
): Promise<void> {
  if (!disposition || !["interested", "callback_requested"].includes(disposition)) return;

  const { data: lead } = await db.from("leads")
    .select("id, counsellor_id, campus_id, course_id, name")
    .eq("id", leadId).single();
  if (!lead || lead.counsellor_id) return;

  // ── Determine which team to assign from ──
  const MIRAI_CAMPUS  = "c0000002-0000-0000-0000-000000000001";
  const BEACON_CAMPUS = "9bb6b4cc-c992-4af1-b9d3-384537a510c8";

  let teamName = "Grn Counselling"; // default fallback

  // Check campus first (school leads)
  if (lead.campus_id === MIRAI_CAMPUS) {
    teamName = "Mirai Admissions";
  } else if (lead.campus_id === BEACON_CAMPUS) {
    teamName = "NSAE II Admissions";
  } else if (lead.course_id) {
    // Check course department
    const { data: course } = await db.from("courses")
      .select("id, department_id, departments:department_id(name)")
      .eq("id", lead.course_id).single();
    const dept = (course?.departments as any)?.name || "";

    if (dept === "Education") {
      teamName = "Grn BEd Admissions";
    } else if (dept === "Law") {
      teamName = "Grn Law Admissions";
    } else if (dept === "Management") {
      teamName = "Grn Mgmt Faculty Admissions";
    }
    // Medical, Nursing, Pharmacy, CS → default Grn Counselling
  }

  // ── Get team members ──
  const { data: teams } = await db.from("teams").select("id").eq("name", teamName).limit(1);
  if (!teams?.length) {
    console.warn(`Team "${teamName}" not found, falling back to Grn Counselling`);
    const { data: fallback } = await db.from("teams").select("id").eq("name", "Grn Counselling").limit(1);
    if (!fallback?.length) return;
    teams[0] = fallback[0];
  }

  const { data: members } = await db.from("team_members").select("user_id").eq("team_id", teams[0].id);
  if (!members?.length) return;

  const userIds = members.map((m: any) => m.user_id);
  const { data: profiles } = await db.from("profiles").select("id, display_name").in("user_id", userIds);
  if (!profiles?.length) return;

  // ── Round-robin: fewest active leads first ──
  const profileIds = profiles.map((p: any) => p.id);
  const { data: leadCounts } = await db
    .from("leads")
    .select("counsellor_id")
    .in("counsellor_id", profileIds)
    .not("stage", "in", "(not_interested,ineligible,dnc,rejected,admitted)");

  const countMap: Record<string, number> = {};
  for (const pid of profileIds) countMap[pid] = 0;
  for (const lc of leadCounts || []) {
    if (lc.counsellor_id) countMap[lc.counsellor_id] = (countMap[lc.counsellor_id] || 0) + 1;
  }

  const sorted = profiles.sort((a: any, b: any) => (countMap[a.id] || 0) - (countMap[b.id] || 0));
  const chosen = sorted[0];

  // ── Assign ──
  await db.from("leads").update({
    counsellor_id: chosen.id,
    stage: "counsellor_call",
  }).eq("id", leadId);

  const scheduledAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
  await db.from("lead_followups").insert({
    lead_id: leadId,
    scheduled_at: scheduledAt,
    type: "call",
    status: "pending",
    notes: `AI call outcome: ${disposition}. Auto-assigned to ${teamName} team.`,
  });

  await db.from("lead_activities").insert({
    lead_id: leadId,
    type: "system",
    description: `Auto-assigned to ${chosen.display_name} (${teamName}) after AI call (${disposition})`,
  });

  await db.from("notifications").insert({
    user_id: chosen.id,
    type: "lead_assigned",
    title: `New lead assigned: ${lead.name || "Unknown"}`,
    body: `AI call outcome: ${disposition}. Follow up within 30 minutes.`,
    link: `/admissions/${leadId}`,
    lead_id: leadId,
  });

  console.log(`Auto-assigned lead ${leadId} to ${chosen.display_name} (${teamName}, ${disposition})`);
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
        // Find the call record by plivo_call_uuid OR ai_call_uuid on the lead
        let callRecord = null;
        const { data: byRecord } = await db.from("ai_call_records")
          .select("id, lead_id")
          .eq("plivo_call_uuid", callUuid)
          .maybeSingle();
        callRecord = byRecord;

        // Fallback: match via leads.ai_call_uuid
        if (!callRecord) {
          const { data: lead } = await db.from("leads").select("id, name")
            .eq("ai_call_uuid", callUuid).maybeSingle();
          if (lead) {
            // Find the latest ai_call_records for this lead
            const { data: latestRecord } = await db.from("ai_call_records")
              .select("id, lead_id")
              .eq("lead_id", lead.id)
              .order("created_at", { ascending: false })
              .limit(1)
              .maybeSingle();
            callRecord = latestRecord;
          }
        }

        if (callRecord) {
          // Update call record with recording
          await db.from("ai_call_records").update({
            recording_url: recordUrl,
            duration_seconds: duration,
            plivo_call_uuid: callUuid,
            status: "completed",
            completed_at: new Date().toISOString(),
          }).eq("id", callRecord.id);

          // Update lead-level fields
          await db.from("leads").update({
            ai_recording_url: recordUrl,
            ai_call_duration_seconds: duration,
          } as any).eq("id", callRecord.lead_id);

          await db.from("lead_notes").insert({
            lead_id: callRecord.lead_id,
            content: `🎙️ AI Call Recording (${Math.floor(duration / 60)}m ${duration % 60}s):\n${recordUrl}`,
          });

          // Transcribe + summarize via Gemini in background (non-blocking)
          const GOOGLE_AI_KEY = Deno.env.get("GOOGLE_AI_API_KEY") || "";
          if (GOOGLE_AI_KEY && recordUrl) {
            transcribeAndSummarize(recordUrl, GOOGLE_AI_KEY).then(async (result) => {
              if (!result) return;
              await db.from("ai_call_records").update({
                transcript: result.transcript,
                summary: result.summary,
                conversion_probability: result.conversionProb,
                disposition: result.disposition,
              }).eq("id", callRecord.id);
              await db.from("leads").update({
                ai_transcript: result.transcript,
                ai_notes: result.summary,
                ai_conversion_probability: result.conversionProb,
              } as any).eq("id", callRecord.lead_id);
              if (result.summary) {
                await db.from("lead_activities").insert({
                  lead_id: callRecord.lead_id, type: "ai_call",
                  description: `AI Call Summary: ${result.summary}${result.conversionProb != null ? ` (${result.conversionProb}% conversion)` : ""}`,
                });
              }
              // Auto-assign counsellor if interested
              await autoAssignCounsellor(db, callRecord.lead_id, result.disposition);
              console.log(`Gemini transcribe+summarize done for call ${callRecord.id}`);
            }).catch(e => console.error("Background transcription error:", e));
          }
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
        .select("id, lead_id, call_uuid, plivo_call_uuid, status")
        .is("recording_url", null)
        .in("status", ["initiated", "completed", "in_progress"])
        .gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
        .order("created_at", { ascending: false })
        .limit(10);

      const GOOGLE_AI_KEY = Deno.env.get("GOOGLE_AI_API_KEY") || "";

      for (const call of pendingCalls || []) {
        let uuid = call.plivo_call_uuid || "";
        if (!uuid) {
          // No plivo UUID — try to find it from the lead's ai_call_uuid
          const { data: lead } = await db.from("leads").select("ai_call_uuid").eq("id", call.lead_id).maybeSingle();
          if (lead?.ai_call_uuid) {
            uuid = lead.ai_call_uuid;
            // Update the record with the plivo UUID
            await db.from("ai_call_records").update({ plivo_call_uuid: uuid }).eq("id", call.id);
          }
        }

        if (!uuid) {
          // Still no UUID — check if call is old enough to mark as failed
          // (if initiated > 10 min ago with no plivo UUID, it likely never connected)
          if (call.status === "initiated") {
            await db.from("ai_call_records").update({
              status: "no_answer",
              completed_at: new Date().toISOString(),
            }).eq("id", call.id);
            console.log(`Marked stale call ${call.id} as no_answer (no plivo UUID found)`);
          }
          continue;
        }

        // First check Plivo call status to update the record status
        if (call.status === "initiated") {
          try {
            const statusRes = await fetch(
              `https://api.plivo.com/v1/Account/${PLIVO_AUTH_ID}/Call/${uuid}/`,
              { headers: { Authorization: "Basic " + btoa(`${PLIVO_AUTH_ID}:${PLIVO_AUTH_TOKEN}`) } }
            );
            if (statusRes.ok) {
              const statusData = await statusRes.json();
              const plivoStatus = (statusData.call_status || statusData.status || "").toLowerCase();
              if (plivoStatus && plivoStatus !== "initiated" && plivoStatus !== "ringing") {
                const statusMap: Record<string, string> = {
                  completed: "completed", busy: "busy", "no-answer": "no_answer",
                  failed: "failed", cancel: "no_answer",
                };
                await db.from("ai_call_records").update({
                  status: statusMap[plivoStatus] || plivoStatus,
                  duration_seconds: parseInt(statusData.bill_duration || statusData.duration || "0"),
                  completed_at: new Date().toISOString(),
                }).eq("id", call.id);
                console.log(`Updated call ${call.id} status from initiated → ${plivoStatus}`);
              }
            }
          } catch (e: any) {
            console.error(`Plivo status check failed for ${uuid}:`, e.message);
          }
        }

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

          // Transcribe + summarize via Gemini
          if (GOOGLE_AI_KEY) {
            const result = await transcribeAndSummarize(recording.url, GOOGLE_AI_KEY);
            if (result) {
              await db.from("ai_call_records").update({
                transcript: result.transcript,
                summary: result.summary,
                conversion_probability: result.conversionProb,
                disposition: result.disposition,
              }).eq("id", call.id);
              await db.from("leads").update({
                ai_transcript: result.transcript,
                ai_notes: result.summary,
                ai_conversion_probability: result.conversionProb,
              } as any).eq("id", call.lead_id);
              if (result.summary) {
                await db.from("lead_activities").insert({
                  lead_id: call.lead_id, type: "ai_call",
                  description: `AI Call Summary: ${result.summary}`,
                });
              }
              await autoAssignCounsellor(db, call.lead_id, result.disposition);
            }
          }
        }
      }
    }

    // ── TRANSCRIBE SCAN: records with recordings but no summary ──
    const GOOGLE_AI_KEY = Deno.env.get("GOOGLE_AI_API_KEY") || "";
    if (GOOGLE_AI_KEY) {
      const { data: untranscribed } = await db
        .from("ai_call_records")
        .select("id, lead_id, recording_url")
        .not("recording_url", "is", null)
        .is("summary", null)
        .eq("status", "completed")
        .order("created_at", { ascending: false })
        .limit(5);

      for (const call of untranscribed || []) {
        if (!call.recording_url) continue;
        console.log(`Transcribing call ${call.id} for lead ${call.lead_id}...`);
        const result = await transcribeAndSummarize(call.recording_url, GOOGLE_AI_KEY);
        if (result) {
          await db.from("ai_call_records").update({
            transcript: result.transcript,
            summary: result.summary,
            conversion_probability: result.conversionProb,
            disposition: result.disposition,
          }).eq("id", call.id);
          await db.from("leads").update({
            ai_transcript: result.transcript,
            ai_notes: result.summary,
            ai_conversion_probability: result.conversionProb,
          } as any).eq("id", call.lead_id);
          if (result.summary) {
            await db.from("lead_activities").insert({
              lead_id: call.lead_id, type: "ai_call",
              description: `AI Call Summary: ${result.summary}`,
            });
          }
          await autoAssignCounsellor(db, call.lead_id, result.disposition);
          console.log(`Transcribed call ${call.id}: ${result.disposition}, ${result.conversionProb}%`);
        }
      }
    }

    // ── SECOND SCAN: leads with ai_call_uuid but no recording (calls placed outside voice-call function) ──
    if (PLIVO_AUTH_ID && PLIVO_AUTH_TOKEN) {
      const { data: leadsWithUuid } = await db
        .from("leads")
        .select("id, name, ai_call_uuid, ai_recording_url")
        .not("ai_call_uuid", "is", null)
        .is("ai_recording_url", null)
        .eq("ai_called", true)
        .gte("ai_called_at", new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString())
        .limit(10);

      for (const lead of leadsWithUuid || []) {
        if (!lead.ai_call_uuid) continue;
        const recording = await fetchPlivoRecording(lead.ai_call_uuid, PLIVO_AUTH_ID, PLIVO_AUTH_TOKEN);
        if (recording) {
          // Update lead directly
          await db.from("leads").update({
            ai_recording_url: recording.url,
            ai_call_duration_seconds: Math.round(recording.duration),
          } as any).eq("id", lead.id);

          // Create or update ai_call_records
          const { data: existingRecord } = await db.from("ai_call_records")
            .select("id").eq("lead_id", lead.id)
            .order("created_at", { ascending: false }).limit(1).maybeSingle();

          if (existingRecord) {
            await db.from("ai_call_records").update({
              recording_url: recording.url,
              duration_seconds: Math.round(recording.duration),
              plivo_call_uuid: lead.ai_call_uuid,
              status: "completed",
              completed_at: new Date().toISOString(),
            }).eq("id", existingRecord.id);
          } else {
            await db.from("ai_call_records").insert({
              lead_id: lead.id,
              plivo_call_uuid: lead.ai_call_uuid,
              recording_url: recording.url,
              duration_seconds: Math.round(recording.duration),
              status: "completed",
              completed_at: new Date().toISOString(),
            });
          }

          await db.from("lead_notes").insert({
            lead_id: lead.id,
            content: `🎙️ AI Call Recording (${Math.floor(recording.duration / 60)}m ${Math.round(recording.duration % 60)}s):\n${recording.url}`,
          });
          console.log(`Recording fetched for lead ${lead.name} via ai_call_uuid ${lead.ai_call_uuid}`);
        }
      }
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("voice-call-callback error:", err?.message, err?.stack);
    return new Response(JSON.stringify({ error: err?.message || "Unknown error" }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
