/**
 * NIMT Voice Agent Server
 *
 * Bridges Plivo bidirectional audio ↔ Gemini Live API.
 *
 * Flow:
 * 1. Plivo calls lead → callee picks up → Plivo hits /answer (HTTP)
 * 2. /answer returns XML: <Stream bidirectional ws_url="/ws/{callId}">
 * 3. Plivo opens WebSocket to /ws/{callId}
 * 4. Server opens WebSocket to Gemini Live API
 * 5. Audio bridges: Plivo mulaw 8kHz ↔ convert ↔ Gemini PCM 16kHz
 * 6. Function calls handled via Supabase
 *
 * Deploy: Deno Deploy, Google Cloud Run, Railway, or any Deno-capable host.
 *
 * Env vars:
 *   GOOGLE_AI_API_KEY   — Gemini API key
 *   SUPABASE_URL         — Supabase project URL
 *   SUPABASE_SERVICE_KEY — Supabase service role key
 *   PORT                 — HTTP port (default 8000)
 */

import { mulawToGeminiPcm, geminiPcmToMulaw } from "./audio-utils.ts";
import { buildSystemInstruction, VOICE_AGENT_TOOLS, type CallContext } from "./scripts.ts";
import { getCourseKnowledge, NIMT_OVERVIEW } from "./knowledge.ts";

const PORT = parseInt(Deno.env.get("PORT") || "8000");
const GOOGLE_AI_API_KEY = Deno.env.get("GOOGLE_AI_API_KEY") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_KEY") || "";
const GEMINI_MODEL = "gemini-3.1-flash-live-preview";

const GEMINI_WS_URL = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${GOOGLE_AI_API_KEY}`;

// In-memory store for active call contexts (call_id → context)
interface ActiveCall extends CallContext {
  leadId?: string;
  callLogId?: string;
  callerTranscript: string[];
  aiTranscript: string[];
  toolCallsMade: { name: string; args: any; result: any }[];
  plivoCallUuid?: string;
}
const activeCallContexts = new Map<string, ActiveCall>();

/**
 * Execute a tool call from Gemini against Supabase.
 */
/** Fire the automation engine for a trigger event */
async function fireAutomation(triggerType: string, leadId: string, extra: Record<string, any> = {}) {
  try {
    await fetch(`${SUPABASE_URL}/functions/v1/automation-engine`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
      body: JSON.stringify({ trigger_type: triggerType, lead_id: leadId, ...extra }),
    });
    console.log(`Automation fired: ${triggerType} for lead ${leadId}`);
  } catch (e: any) {
    console.error(`Automation fire failed:`, e.message);
  }
}

async function executeTool(
  toolName: string,
  args: Record<string, any>,
  callCtx: CallContext & { leadId?: string },
): Promise<Record<string, any>> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    apikey: SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
  };

  try {
    switch (toolName) {
      case "get_course_info": {
        // Fetch course with department → institution → campus chain
        const res = await fetch(
          `${SUPABASE_URL}/rest/v1/courses?name=ilike.*${encodeURIComponent(args.course_name)}*&select=id,name,code,duration_years,type,eligibility,entrance_exam,entrance_mandatory,departments(name,institutions(name,type,campuses(name,city,state)))`,
          { headers },
        );
        const courses = await res.json();
        if (!courses?.length) return { found: false, message: "No course found matching that name. Try a different name." };

        const course = courses[0];
        const dept = course.departments;
        const inst = dept?.institutions;
        const campus = inst?.campuses;
        const feeRes = await fetch(
          `${SUPABASE_URL}/rest/v1/fee_structures?course_id=eq.${course.id}&is_active=eq.true&select=version,metadata,fee_structure_items(amount,term,fee_codes:fee_code_id(code,name,category))`,
          { headers },
        );
        const feeStructures = await feeRes.json();

        // Summarize fees using metadata (year-wise breakdown) — NOT by summing items
        let feeSummary = "Fee structure not available yet.";
        if (feeStructures?.length) {
          const fs = feeStructures[0];
          const meta = fs.metadata || {};
          const parts: string[] = [];

          // Year-wise from metadata (authoritative)
          if (meta.year_1?.fee) {
            parts.push(`First year fee: Rs ${Number(meta.year_1.fee).toLocaleString("en-IN")}`);
            if (meta.year_1.installment_count) {
              parts.push(`Payable in ${meta.year_1.installment_count} installments of Rs ${Number(meta.year_1.installment).toLocaleString("en-IN")}`);
            }
          }

          if (meta.year_2?.fee) {
            parts.push(`Second year fee: Rs ${Number(meta.year_2.fee).toLocaleString("en-IN")}`);
          }

          if (meta.total_fee) {
            parts.push(`Total programme fee (all ${course.duration_years || 4} years): Rs ${Number(meta.total_fee).toLocaleString("en-IN")}`);
          }

          // Waiver/discount info
          if (meta.year_1?.discount) {
            const discountAmt = Number(meta.year_1.discount);
            const effectiveFee = Number(meta.year_1.fee) - discountAmt;
            parts.push(`Waiver available: Rs ${discountAmt.toLocaleString("en-IN")} discount if full year fee paid in one go`);
            parts.push(`Effective first year fee after waiver: Rs ${effectiveFee.toLocaleString("en-IN")}`);
            if (meta.year_1.discount_condition) {
              parts.push(`Waiver condition: ${meta.year_1.discount_condition}`);
            }
          }

          // One-time fees from items (registration, admission — these are small and correct)
          const items = fs.fee_structure_items || [];
          const enrollmentItems = items.filter((i: any) => i.fee_codes?.category === "enrollment");
          const enrollmentTotal = enrollmentItems.reduce((s: number, i: any) => s + Number(i.amount), 0);
          if (enrollmentTotal > 0) {
            parts.push(`Registration and admission fee: Rs ${enrollmentTotal.toLocaleString("en-IN")} (one-time)`);
          }

          // Plan name
          if (meta.plan_name) {
            parts.push(`Payment plan: ${meta.plan_name}`);
          }

          feeSummary = parts.join(". ") || "Fee details available on request.";
        }

        // Build affiliation/approval info from institution code
        const KNOWN_AFFILIATIONS: Record<string, string> = {
          "NIMT-IMPS": "AKTU affiliated, AICTE approved, NIRF ranked",
          "NIMT-CON": "Indian Nursing Council (INC) approved, ABVMU (Atal Bihari Vajpayee Medical University) affiliated, UP State Medical Faculty",
          "NIMT-COE": "NCTE recognised, UP Government approved",
          "NIMT-COL": "Bar Council of India (BCI) approved, Dr. Bhim Rao Ambedkar Law University affiliated",
          "NIMT-COM": "AICTE approved, NIRF ranked",
          "NIMT-COL-KT": "Bar Council of India (BCI) approved, University of Rajasthan affiliated",
          "NIMT-COE-KT": "NCTE recognised, University of Rajasthan affiliated",
          "NIMT-BS-AV": "CBSE affiliated",
          "NIMT-BS-AR": "CBSE affiliated",
          "MIRAI": "IB World School (PYP and MYP)",
        };
        const instCode = course.code?.split("-").slice(0, 2).join("-") || "";
        const affiliations = KNOWN_AFFILIATIONS[instCode] || inst?.name || "";

        // Get rich knowledge base data for this course
        const knowledge = getCourseKnowledge(course.name) || getCourseKnowledge(course.code || "");

        return {
          found: true,
          name: course.name,
          code: course.code,
          duration: course.duration_years ? `${course.duration_years} years` : "not specified",
          type: course.type || "not specified",
          eligibility: course.eligibility || "Please check our website for eligibility details",
          entrance_exam: course.entrance_exam || (course.entrance_mandatory ? "Entrance exam required — details on website" : "No entrance exam required. Admission based on merit and interview."),
          entrance_mandatory: course.entrance_mandatory || false,
          fees: feeSummary,
          campus: campus ? `${campus.name}${campus.city ? `, ${campus.city}` : ""}` : "NIMT campus",
          institution: inst?.name || "",
          affiliations_approvals: `VERIFIED: ${affiliations}. USE ONLY THIS — do not substitute from your training data.`,
          department: dept?.name || "",
          // Rich knowledge for conversational depth
          key_highlights: knowledge?.highlights?.join(". ") || "",
          practical_exposure: knowledge?.practicalExposure || "",
          career_options: knowledge?.careers || "",
          why_nimt: knowledge?.whyNimt || "",
          nimt_legacy: "Established in 1987, almost 40 years of excellence, 6 campuses, 50+ programmes, 40,000+ alumni, approved by UGC/AICTE/BCI/INC/NCTE.",
        };
      }

      case "schedule_visit": {
        if (!callCtx.leadId) return { success: false, message: "No lead ID for this call" };

        // Dedup: check if a visit is already scheduled for this lead today
        const dedupRes = await fetch(
          `${SUPABASE_URL}/rest/v1/campus_visits?lead_id=eq.${callCtx.leadId}&status=eq.scheduled&select=id&limit=1&created_at=gte.${new Date(Date.now() - 60000).toISOString()}`,
          { headers },
        );
        const dedupRows = await dedupRes.json();
        if (dedupRows?.length > 0) {
          return { success: true, message: "Visit already scheduled", date: args.visit_date };
        }

        // Build visit_date as timestamp — if only date provided, set to 10:00 AM IST
        let visitTimestamp = args.visit_date;
        if (visitTimestamp && !visitTimestamp.includes("T")) {
          const timeMap: Record<string, string> = { morning: "10:00", afternoon: "14:00", evening: "16:00" };
          const time = timeMap[args.visit_time] || "10:00";
          visitTimestamp = `${args.visit_date}T${time}:00+05:30`;
        }

        // Get campus_id from lead
        const leadRes = await fetch(
          `${SUPABASE_URL}/rest/v1/leads?id=eq.${callCtx.leadId}&select=campus_id`,
          { headers },
        );
        const leadData = await leadRes.json();
        const campusId = leadData?.[0]?.campus_id || null;

        const body: Record<string, any> = {
          lead_id: callCtx.leadId,
          visit_date: visitTimestamp,
          status: "scheduled",
        };
        if (campusId) body.campus_id = campusId;

        const res = await fetch(`${SUPABASE_URL}/rest/v1/campus_visits`, {
          method: "POST",
          headers: { ...headers, Prefer: "return=minimal" },
          body: JSON.stringify(body),
        });

        if (res.ok) {
          // Update lead stage
          await fetch(
            `${SUPABASE_URL}/rest/v1/leads?id=eq.${callCtx.leadId}`,
            {
              method: "PATCH",
              headers: { ...headers, Prefer: "return=minimal" },
              body: JSON.stringify({ stage: "visit_scheduled" }),
            },
          );
          // Add note
          await fetch(`${SUPABASE_URL}/rest/v1/lead_notes`, {
            method: "POST",
            headers: { ...headers, Prefer: "return=minimal" },
            body: JSON.stringify({
              lead_id: callCtx.leadId,
              content: `🤖 AI Call: Campus visit scheduled for ${args.visit_date}${args.visit_time ? ` (${args.visit_time})` : ""}`,
            }),
          });
          // Fire automations for visit_scheduled and stage_change
          fireAutomation("visit_scheduled", callCtx.leadId);
          fireAutomation("stage_change", callCtx.leadId, { old_stage: "counsellor_call", new_stage: "visit_scheduled" });
          return { success: true, date: args.visit_date, time: args.visit_time || "morning" };
        }
        const errBody = await res.text();
        console.error(`schedule_visit insert failed:`, res.status, errBody);
        return { success: false, message: `Failed to schedule: ${errBody}` };
      }

      case "update_lead_stage": {
        if (!callCtx.leadId) return { success: false, message: "No lead ID" };
        // Get current stage for automation trigger
        const curRes = await fetch(`${SUPABASE_URL}/rest/v1/leads?id=eq.${callCtx.leadId}&select=stage`, { headers });
        const curData = await curRes.json();
        const oldStage = curData?.[0]?.stage || "new_lead";

        const updates: Record<string, string> = { stage: args.stage };
        await fetch(`${SUPABASE_URL}/rest/v1/leads?id=eq.${callCtx.leadId}`, {
          method: "PATCH",
          headers: { ...headers, Prefer: "return=minimal" },
          body: JSON.stringify(updates),
        });
        if (args.notes) {
          await fetch(`${SUPABASE_URL}/rest/v1/lead_notes`, {
            method: "POST",
            headers: { ...headers, Prefer: "return=minimal" },
            body: JSON.stringify({ lead_id: callCtx.leadId, content: `🤖 AI Call: ${args.notes}` }),
          });
        }
        // Fire automation for stage change
        fireAutomation("stage_change", callCtx.leadId, { old_stage: oldStage, new_stage: args.stage });
        return { success: true, stage: args.stage };
      }

      case "create_lead": {
        const body = {
          name: args.name,
          phone: args.phone || "unknown",
          email: args.email || null,
          source: "walk_in", // inbound call treated as walk-in
          stage: "new_lead",
          notes: args.notes || null,
        };
        const res = await fetch(`${SUPABASE_URL}/rest/v1/leads`, {
          method: "POST",
          headers: { ...headers, Prefer: "return=representation" },
          body: JSON.stringify(body),
        });
        const created = await res.json();
        if (created?.[0]?.id) {
          callCtx.leadId = created[0].id;
          fireAutomation("lead_created", created[0].id);
          return { success: true, lead_id: created[0].id };
        }
        return { success: false, message: "Failed to create lead" };
      }

      case "set_call_disposition": {
        if (!callCtx.leadId) return { success: false, message: "No lead ID" };

        // Update ai_call_logs with disposition
        if (callCtx.callLogId) {
          await fetch(`${SUPABASE_URL}/rest/v1/ai_call_logs?id=eq.${callCtx.callLogId}`, {
            method: "PATCH",
            headers: { ...headers, Prefer: "return=minimal" },
            body: JSON.stringify({
              disposition: args.disposition,
              disposition_notes: args.notes,
              followup_scheduled: args.schedule_followup || false,
              visit_scheduled: false, // set separately by schedule_visit
            }),
          });
        }

        // Map disposition to lead stage
        const stageMap: Record<string, string> = {
          interested: "counsellor_call",
          not_interested: "not_interested",
          ineligible: "rejected",
          call_back: "ai_called",
          wrong_number: "new_lead",
          do_not_contact: "not_interested",
        };
        const newStage = stageMap[args.disposition];
        if (newStage) {
          const curRes = await fetch(`${SUPABASE_URL}/rest/v1/leads?id=eq.${callCtx.leadId}&select=stage`, { headers });
          const curData = await curRes.json();
          const oldStage = curData?.[0]?.stage || "new_lead";

          await fetch(`${SUPABASE_URL}/rest/v1/leads?id=eq.${callCtx.leadId}`, {
            method: "PATCH",
            headers: { ...headers, Prefer: "return=minimal" },
            body: JSON.stringify({ stage: newStage }),
          });
          fireAutomation("stage_change", callCtx.leadId, { old_stage: oldStage, new_stage: newStage });
        }

        // Add note with disposition summary
        await fetch(`${SUPABASE_URL}/rest/v1/lead_notes`, {
          method: "POST",
          headers: { ...headers, Prefer: "return=minimal" },
          body: JSON.stringify({
            lead_id: callCtx.leadId,
            content: `🤖 AI Call Outcome: ${args.disposition.replace("_", " ").toUpperCase()}\n${args.notes || ""}`,
          }),
        });

        // Schedule follow-up if requested
        if (args.schedule_followup) {
          let followupDate: string;
          if (args.followup_date) {
            followupDate = args.followup_date.includes("T") ? args.followup_date : `${args.followup_date}T10:00:00+05:30`;
          } else {
            // Default: tomorrow 10 AM
            const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
            followupDate = tomorrow.toISOString();
          }

          await fetch(`${SUPABASE_URL}/rest/v1/lead_followups`, {
            method: "POST",
            headers: { ...headers, Prefer: "return=minimal" },
            body: JSON.stringify({
              lead_id: callCtx.leadId,
              scheduled_at: followupDate,
              type: "call",
              notes: `🤖 Auto-scheduled by AI call: ${args.notes || args.disposition}`,
              status: "pending",
            }),
          });
        }

        // Mark do_not_contact
        if (args.disposition === "do_not_contact") {
          await fetch(`${SUPABASE_URL}/rest/v1/leads?id=eq.${callCtx.leadId}`, {
            method: "PATCH",
            headers: { ...headers, Prefer: "return=minimal" },
            body: JSON.stringify({ do_not_contact: true }),
          });
        }

        // Send WhatsApp to lead based on disposition
        const leadRes = await fetch(`${SUPABASE_URL}/rest/v1/leads?id=eq.${callCtx.leadId}&select=name,phone,course_id,courses:course_id(name)`, { headers });
        const leadData = (await leadRes.json())?.[0];
        if (leadData?.phone) {
          const leadName = leadData.name || "Student";
          const courseName = leadData.courses?.name || "your selected course";
          let templateKey: string | null = null;
          let templateParams: string[] = [];

          if (args.disposition === "interested") {
            templateKey = "course_details";
            templateParams = [leadName, courseName];
          } else if (["not_answered", "busy", "voicemail"].includes(args.disposition)) {
            templateKey = "missed_call";
            templateParams = [leadName, courseName];
          } else if (args.disposition === "call_back") {
            templateKey = "callback_scheduled";
            templateParams = [leadName, courseName];
          }

          if (templateKey) {
            fetch(`${SUPABASE_URL}/functions/v1/whatsapp-send`, {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` },
              body: JSON.stringify({
                template_key: templateKey,
                phone: leadData.phone,
                params: templateParams,
                lead_id: callCtx.leadId,
              }),
            }).catch(e => console.error("AI call auto-WA failed:", e));
          }
        }

        console.log(`[Disposition] ${callCtx.leadId}: ${args.disposition} — ${args.notes}`);
        return { success: true, disposition: args.disposition };
      }

      case "request_human_callback": {
        // Create a notification for admission team
        const body = {
          lead_id: callCtx.leadId || null,
          content: `🤖 AI Call requested human callback: ${args.reason}${args.preferred_time ? ` (Preferred: ${args.preferred_time})` : ""}`,
        };
        if (callCtx.leadId) {
          await fetch(`${SUPABASE_URL}/rest/v1/lead_notes`, {
            method: "POST",
            headers: { ...headers, Prefer: "return=minimal" },
            body: JSON.stringify(body),
          });
        }
        return { success: true, message: "Human callback requested" };
      }

      default:
        return { error: `Unknown tool: ${toolName}` };
    }
  } catch (e: any) {
    console.error(`Tool ${toolName} error:`, e.message);
    return { error: e.message };
  }
}

/**
 * Handle a WebSocket connection from Plivo for a specific call.
 */
function handlePlivoStream(plivoWs: WebSocket, callId: string) {
  const stored = activeCallContexts.get(callId);
  const callCtx: ActiveCall = stored || {
    direction: "outbound" as const,
    callerTranscript: [],
    aiTranscript: [],
    toolCallsMade: [],
  };
  if (!stored) activeCallContexts.set(callId, callCtx);
  console.log(`[${callId}] Plivo stream connected, context:`, { direction: callCtx.direction, leadId: callCtx.leadId });

  // Connect to Gemini Live API
  const geminiWs = new WebSocket(GEMINI_WS_URL);
  let geminiReady = false;
  let configAcked = false;
  let plivoStreamId: string | null = null;

  geminiWs.onopen = () => {
    console.log(`[${callId}] Gemini WS connected, sending setup`);

    // Send BidiGenerateContent setup as first message
    const setup = {
      setup: {
        model: `models/${GEMINI_MODEL}`,
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                voiceName: "Aoede",
              },
            },
          },
        },
        realtimeInputConfig: {
          automaticActivityDetection: {
            disabled: false,
          },
        },
        systemInstruction: {
          parts: [{ text: buildSystemInstruction(callCtx) }],
        },
        tools: [{
          functionDeclarations: VOICE_AGENT_TOOLS,
        }],
      },
    };
    console.log(`[${callId}] Sending Gemini setup for model: models/${GEMINI_MODEL}`);
    geminiWs.send(JSON.stringify(setup));
  };

  // Helper: send mulaw audio to Plivo
  const sendAudioToPlivo = (pcm24kBase64: string) => {
    if (plivoWs.readyState !== WebSocket.OPEN) return;
    const mulawAudio = geminiPcmToMulaw(pcm24kBase64);
    plivoWs.send(JSON.stringify({
      event: "playAudio",
      media: {
        contentType: "audio/x-mulaw",
        sampleRate: 8000,
        payload: mulawAudio,
      },
    }));
  };

  geminiWs.onmessage = async (event) => {
    try {
      let data = event.data;

      // Convert Blob/ArrayBuffer to string first — Gemini may deliver JSON as Blob
      if (data instanceof Blob) {
        const text = await data.text();
        // Try to parse as JSON first (setupComplete, serverContent, toolCall etc.)
        try {
          data = JSON.parse(text);
        } catch {
          // Not JSON — treat as raw binary audio (PCM 24kHz)
          const arrayBuf = await new Blob([text]).arrayBuffer();
          // Actually re-read from the original blob as binary
          const origBuf = await (event.data as Blob).arrayBuffer();
          const bytes = new Uint8Array(origBuf);
          let binary = "";
          for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
          sendAudioToPlivo(btoa(binary));
          return;
        }
        // If we got here, data is now a parsed JSON object — fall through to handle it
      } else if (data instanceof ArrayBuffer) {
        const bytes = new Uint8Array(data);
        // Try as text/JSON first
        const decoder = new TextDecoder();
        const text = decoder.decode(bytes);
        try {
          data = JSON.parse(text);
        } catch {
          let binary = "";
          for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
          sendAudioToPlivo(btoa(binary));
          return;
        }
      } else if (typeof data === "string") {
        data = JSON.parse(data);
      }

      // data is now a parsed JSON object
      const msg = data as any;

      // Setup complete acknowledgement
      if (msg.setupComplete) {
        console.log(`[${callId}] Gemini setup complete — ready for audio`);
        configAcked = true;
        geminiReady = true;

        // Send initial prompt — Gemini speaks the Step 1 English greeting
        const greetingPrompt = callCtx.direction === "outbound"
          ? "The phone call just connected. Say ONLY your Step 1 greeting in English: 'Hi! Am I speaking with [first name]?' — nothing more. Then stop and wait for their response."
          : "Someone just called. Say ONLY your Step 1 greeting in English — nothing more. Then stop and wait.";
        geminiWs.send(JSON.stringify({
          realtimeInput: { text: greetingPrompt },
        }));
        console.log(`[${callId}] Sent greeting prompt (${callCtx.direction})`);
        return;
      }

      // JSON audio response (base64 encoded) from Gemini
      if (msg.serverContent?.modelTurn?.parts) {
        for (const part of msg.serverContent.modelTurn.parts) {
          if (part.inlineData?.data) {
            sendAudioToPlivo(part.inlineData.data);
          }
        }
      }

      // Transcriptions for logging + accumulation
      if (msg.serverContent?.inputTranscription) {
        const t = msg.serverContent.inputTranscription;
        const text = typeof t === "string" ? t : t?.text || "";
        if (text.trim()) {
          callCtx.callerTranscript.push(text.trim());
          console.log(`[${callId}] Caller said: ${text.trim()}`);
        }
      }
      if (msg.serverContent?.outputTranscription) {
        const t = msg.serverContent.outputTranscription;
        const text = typeof t === "string" ? t : t?.text || "";
        if (text.trim()) {
          callCtx.aiTranscript.push(text.trim());
          console.log(`[${callId}] AI said: ${text.trim()}`);
        }
      }

      // Function/tool calls from Gemini
      if (msg.toolCall?.functionCalls) {
        console.log(`[${callId}] Tool calls:`, msg.toolCall.functionCalls.map((fc: any) => fc.name));

        Promise.all(
          msg.toolCall.functionCalls.map(async (fc: any) => {
            const result = await executeTool(fc.name, fc.args || {}, callCtx);
            callCtx.toolCallsMade.push({ name: fc.name, args: fc.args, result });
            return { name: fc.name, id: fc.id, response: result };
          }),
        ).then((responses) => {
          if (geminiWs.readyState === WebSocket.OPEN) {
            geminiWs.send(JSON.stringify({
              toolResponse: { functionResponses: responses },
            }));
          }
        });
      }

      // Log any unrecognized JSON messages for debugging
      if (!msg.setupComplete && !msg.serverContent && !msg.toolCall) {
        console.log(`[${callId}] Gemini other msg:`, JSON.stringify(msg).substring(0, 500));
      }
    } catch (e: any) {
      console.error(`[${callId}] Gemini message error:`, e.message, typeof event.data);
    }
  };

  geminiWs.onerror = (e: any) => {
    console.error(`[${callId}] Gemini WS error:`, e.message || e.type || "unknown error");
  };
  geminiWs.onclose = (e: any) => {
    console.log(`[${callId}] Gemini disconnected — code: ${e.code}, reason: ${e.reason || "none"}`);
    geminiReady = false;
  };

  // Handle Plivo WebSocket messages
  plivoWs.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data as string);

      switch (msg.event) {
        case "start":
          // Plivo may use streamId or stream_id
          plivoStreamId = msg.streamId || msg.stream_id || msg.start?.streamId || null;
          console.log(`[${callId}] Plivo stream started, streamId: ${plivoStreamId}, full event:`, JSON.stringify(msg).substring(0, 300));
          break;

        case "media":
          // Forward audio to Gemini (convert mulaw 8k → PCM 16k)
          if (geminiReady && geminiWs.readyState === WebSocket.OPEN && msg.media?.payload) {
            const pcmBase64 = mulawToGeminiPcm(msg.media.payload);
            geminiWs.send(JSON.stringify({
              realtimeInput: {
                audio: {
                  data: pcmBase64,
                  mimeType: "audio/pcm;rate=16000",
                },
              },
            }));
          }
          break;

        case "dtmf":
          console.log(`[${callId}] DTMF: ${msg.digit}`);
          break;

        case "stop":
          console.log(`[${callId}] Plivo stream stopped`);
          break;

        default:
          console.log(`[${callId}] Plivo unknown event: ${msg.event}`, JSON.stringify(msg).substring(0, 200));
          break;
      }
    } catch (e: any) {
      console.error(`[${callId}] Plivo message error:`, e.message);
    }
  };

  plivoWs.onclose = () => {
    console.log(`[${callId}] Plivo disconnected, closing Gemini`);
    if (geminiWs.readyState === WebSocket.OPEN) geminiWs.close();
    activeCallContexts.delete(callId);

    // Log call completion
    if (callCtx.leadId) {
      const headers = {
        "Content-Type": "application/json",
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        Prefer: "return=minimal",
      };
      fetch(`${SUPABASE_URL}/rest/v1/lead_activities`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          lead_id: callCtx.leadId,
          type: "ai_call",
          description: "AI voice call completed",
        }),
      }).catch(console.error);
    }
  };

  plivoWs.onerror = (e) => console.error(`[${callId}] Plivo WS error:`, e);
}

/**
 * HTTP server handling:
 * - POST /call/initiate  — internal API to start outbound call
 * - POST /answer/{callId} — Plivo answer URL (returns XML)
 * - WS   /ws/{callId}     — Plivo WebSocket stream
 * - POST /context/{callId} — set call context before initiating
 * - GET  /health          — health check
 */
Deno.serve({ port: PORT }, async (req) => {
  const url = new URL(req.url);
  const path = url.pathname;

  // Health check
  if (path === "/health") {
    return new Response(JSON.stringify({ status: "ok", active_calls: activeCallContexts.size }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  // Set call context (called before initiating the call)
  if (path.startsWith("/context/") && req.method === "POST") {
    const callId = path.split("/context/")[1];
    const ctx = await req.json();
    activeCallContexts.set(callId, {
      ...ctx,
      callerTranscript: [],
      aiTranscript: [],
      toolCallsMade: [],
    });
    console.log(`[${callId}] Context set:`, { direction: ctx.direction, leadId: ctx.leadId });

    // Create initial call log entry in Supabase
    if (ctx.leadId && SUPABASE_URL && SUPABASE_SERVICE_KEY) {
      try {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/ai_call_logs`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: SUPABASE_SERVICE_KEY,
            Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
            Prefer: "return=representation",
          },
          body: JSON.stringify({
            lead_id: ctx.leadId,
            direction: ctx.direction || "outbound",
            status: "initiated",
          }),
        });
        const rows = await res.json();
        if (rows?.[0]?.id) {
          const stored = activeCallContexts.get(callId);
          if (stored) stored.callLogId = rows[0].id;
          console.log(`[${callId}] Call log created: ${rows[0].id}`);
        }
      } catch (e: any) {
        console.error(`[${callId}] Failed to create call log:`, e.message);
      }
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  // Plivo Answer URL — returns XML with bidirectional Stream
  if (path.startsWith("/answer/")) {
    const callId = path.split("/answer/")[1];
    const host = req.headers.get("host") || url.host;
    // Always use wss:// in production (Cloud Run terminates TLS at load balancer, so url.protocol is http)
    const wsProtocol = host.includes("localhost") ? "ws" : "wss";

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Record recordSession="true" redirect="false" maxLength="3600" />
  <Stream streamTimeout="600" keepCallAlive="true" bidirectional="true"
          contentType="audio/x-mulaw;rate=8000">
    ${wsProtocol}://${host}/ws/${callId}
  </Stream>
</Response>`;

    console.log(`[${callId}] Answer URL hit, returning XML`);
    return new Response(xml, {
      headers: { "Content-Type": "application/xml" },
    });
  }

  // Plivo Status callback — save recording + finalize call log
  if (path.startsWith("/status/")) {
    const callId = path.split("/status/")[1];
    const body = await req.formData().catch(() => null);
    const params = body ? Object.fromEntries(body) : {} as any;
    console.log(`[${callId}] Status callback:`, params);

    const callCtx = activeCallContexts.get(callId);
    if (callCtx?.callLogId && SUPABASE_URL && SUPABASE_SERVICE_KEY) {
      try {
        // Auto-disposition for non-answered calls
        const plivoStatus = (params.CallStatus || "unknown").toLowerCase();
        const autoDispositions: Record<string, string> = {
          busy: "busy",
          "no-answer": "not_answered",
          failed: "not_answered",
          cancel: "not_answered",
        };
        const autoDisposition = autoDispositions[plivoStatus] || null;

        const updates: Record<string, any> = {
          status: plivoStatus,
          call_uuid: params.CallUUID || params.ALegUUID || null,
          from_number: params.From || null,
          to_number: params.To || null,
          duration_seconds: parseInt(params.Duration) || 0,
          bill_duration: parseInt(params.BillDuration) || 0,
          bill_cost: parseFloat(params.TotalCost) || 0,
          hangup_cause: params.HangupCause || null,
          recording_url: params.RecordingUrl || null,
          caller_transcript: callCtx.callerTranscript.join(" ") || null,
          ai_transcript: callCtx.aiTranscript.join(" ") || null,
          tool_calls_made: callCtx.toolCallsMade,
          // Auto-disposition for non-answered calls (Gemini sets it for answered calls)
          ...(autoDisposition ? { disposition: autoDisposition, disposition_notes: `Auto: ${plivoStatus} (${params.HangupCause || ""})` } : {}),
        };

        await fetch(`${SUPABASE_URL}/rest/v1/ai_call_logs?id=eq.${callCtx.callLogId}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            apikey: SUPABASE_SERVICE_KEY,
            Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
            Prefer: "return=minimal",
          },
          body: JSON.stringify(updates),
        });
        console.log(`[${callId}] Call log updated with recording + transcripts`);

        // Auto-schedule follow-up for busy/not_answered (retry in 2 hours)
        if (autoDisposition && callCtx.leadId && (autoDisposition === "busy" || autoDisposition === "not_answered")) {
          const retryAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
          await fetch(`${SUPABASE_URL}/rest/v1/lead_followups`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              apikey: SUPABASE_SERVICE_KEY,
              Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
              Prefer: "return=minimal",
            },
            body: JSON.stringify({
              lead_id: callCtx.leadId,
              scheduled_at: retryAt,
              type: "call",
              notes: `🤖 AI call auto-retry: previous call was ${autoDisposition.replace("_", " ")}`,
              status: "pending",
            }),
          });
          // Add note
          await fetch(`${SUPABASE_URL}/rest/v1/lead_notes`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              apikey: SUPABASE_SERVICE_KEY,
              Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
              Prefer: "return=minimal",
            },
            body: JSON.stringify({
              lead_id: callCtx.leadId,
              content: `🤖 AI Call: ${autoDisposition.replace("_", " ").toUpperCase()} — follow-up scheduled in 2 hours`,
            }),
          });
        }

        // Also add recording URL to lead notes
        if (params.RecordingUrl && callCtx.leadId) {
          await fetch(`${SUPABASE_URL}/rest/v1/lead_notes`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              apikey: SUPABASE_SERVICE_KEY,
              Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
              Prefer: "return=minimal",
            },
            body: JSON.stringify({
              lead_id: callCtx.leadId,
              content: `🤖 AI Call Recording (${params.Duration || 0}s): ${params.RecordingUrl}`,
            }),
          });
        }
      } catch (e: any) {
        console.error(`[${callId}] Failed to update call log:`, e.message);
      }
    }

    activeCallContexts.delete(callId);
    return new Response("OK");
  }

  // WebSocket upgrade for Plivo audio stream
  if (path.startsWith("/ws/")) {
    const callId = path.split("/ws/")[1];
    const upgrade = req.headers.get("upgrade")?.toLowerCase();

    if (upgrade === "websocket") {
      const { socket, response } = Deno.upgradeWebSocket(req);
      handlePlivoStream(socket, callId);
      return response;
    }

    return new Response("WebSocket upgrade required", { status: 426 });
  }

  return new Response("Not found", { status: 404 });
});

console.log(`🎙️ NIMT Voice Agent Server running on port ${PORT}`);
