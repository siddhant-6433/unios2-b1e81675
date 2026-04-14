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

// ── Transcribe recording using OpenAI Whisper API ──
async function transcribeRecording(recordingUrl: string, openaiKey: string): Promise<string | null> {
  try {
    // Download the recording
    const audioRes = await fetch(recordingUrl);
    if (!audioRes.ok) { console.error("Failed to download recording:", audioRes.status); return null; }
    const audioBlob = await audioRes.blob();

    // Send to Whisper
    const formData = new FormData();
    formData.append("file", audioBlob, "recording.mp3");
    formData.append("model", "whisper-1");
    formData.append("language", "en");
    formData.append("response_format", "text");

    const whisperRes = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${openaiKey}` },
      body: formData,
    });
    if (!whisperRes.ok) {
      console.error("Whisper error:", whisperRes.status, await whisperRes.text());
      return null;
    }
    return await whisperRes.text();
  } catch (e) {
    console.error("Transcription error:", e);
    return null;
  }
}

// ── Generate call summary using AI ──
async function generateCallSummary(transcript: string, lovableKey: string): Promise<{ summary: string; conversionProb: number | null; disposition: string | null } | null> {
  try {
    const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${lovableKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.0-flash-001",
        messages: [
          {
            role: "system",
            content: `You are an admissions CRM assistant. Analyse this AI-lead phone call transcript and provide:
1. A concise summary (2-4 sentences) of the call outcome — what the caller discussed, what the lead's response/interest level was
2. A conversion probability (0-100%) — how likely this lead is to enroll
3. A disposition: one of: interested, callback_requested, not_interested, no_answer, busy, wrong_number, voicemail, partial_conversation

Respond in JSON: {"summary": "...", "conversion_probability": N, "disposition": "..."}`
          },
          { role: "user", content: `Transcript:\n${transcript}` }
        ],
        response_format: { type: "json_object" },
      }),
    });
    if (!res.ok) { console.error("AI summary error:", res.status); return null; }
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) return null;
    const parsed = JSON.parse(content);
    return {
      summary: parsed.summary || null,
      conversionProb: typeof parsed.conversion_probability === "number" ? parsed.conversion_probability : null,
      disposition: parsed.disposition || null,
    };
  } catch (e) {
    console.error("AI summary error:", e);
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

          // Transcribe + summarize in background (non-blocking)
          const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") || "";
          const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY") || "";
          if (OPENAI_API_KEY && recordUrl) {
            transcribeRecording(recordUrl, OPENAI_API_KEY).then(async (transcript) => {
              if (!transcript) return;
              const updates: Record<string, any> = { transcript };
              await db.from("ai_call_records").update(updates).eq("id", callRecord.id);
              await db.from("leads").update({ ai_transcript: transcript } as any).eq("id", callRecord.lead_id);

              // Generate summary from transcript
              if (LOVABLE_API_KEY) {
                const result = await generateCallSummary(transcript, LOVABLE_API_KEY);
                if (result) {
                  await db.from("ai_call_records").update({
                    summary: result.summary,
                    conversion_probability: result.conversionProb,
                    disposition: result.disposition,
                  }).eq("id", callRecord.id);
                  await db.from("leads").update({
                    ai_notes: result.summary,
                    ai_conversion_probability: result.conversionProb,
                  } as any).eq("id", callRecord.lead_id);
                  await db.from("lead_activities").insert({
                    lead_id: callRecord.lead_id, type: "ai_call",
                    description: `AI Call Summary: ${result.summary}${result.conversionProb != null ? ` (${result.conversionProb}% conversion)` : ""}`,
                  });
                  console.log(`Transcription + summary done for call ${callRecord.id}`);
                }
              }
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
        .select("id, lead_id, call_uuid, plivo_call_uuid")
        .is("recording_url", null)
        .in("status", ["initiated", "completed", "in_progress"])
        .gte("created_at", new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
        .order("created_at", { ascending: false })
        .limit(10);

      const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") || "";
      const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY") || "";

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

          // Transcribe + summarize
          if (OPENAI_API_KEY) {
            const transcript = await transcribeRecording(recording.url, OPENAI_API_KEY);
            if (transcript) {
              await db.from("ai_call_records").update({ transcript }).eq("id", call.id);
              await db.from("leads").update({ ai_transcript: transcript } as any).eq("id", call.lead_id);

              if (LOVABLE_API_KEY) {
                const result = await generateCallSummary(transcript, LOVABLE_API_KEY);
                if (result) {
                  await db.from("ai_call_records").update({
                    summary: result.summary,
                    conversion_probability: result.conversionProb,
                    disposition: result.disposition,
                  }).eq("id", call.id);
                  await db.from("leads").update({
                    ai_notes: result.summary,
                    ai_conversion_probability: result.conversionProb,
                  } as any).eq("id", call.lead_id);
                  await db.from("lead_activities").insert({
                    lead_id: call.lead_id, type: "ai_call",
                    description: `AI Call Summary: ${result.summary}`,
                  });
                }
              }
            }
          }
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
