// WhatsApp message intent classifier (LLM)
// Called by:
//   - cron worker fn_process_wa_classification_queue (passes {queue_id})
//   - directly with {content, lead_id?, message_id?, phone?} for backfill
//
// Returns the structured classification AND, when confident enough, mutates
// the lead (person_role) so the existing job_applicants trigger fires.

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const HIGH_CONFIDENCE = 0.8;

const SYSTEM_PROMPT = `You classify WhatsApp messages received by a college admissions helpdesk in India (NIMT — admissions for nursing, MBA, PGDM, BPT, BBA, BCA, B.Ed, law, pharmacy, etc.).

Most messages are from prospective students or parents asking about admissions, courses, fees, hostel, scholarship, campus visits, etc.

Some messages are NOT about admission:
- JOB APPLICANTS: people looking for employment at NIMT (faculty, teacher, peon, driver, guard, clerk, receptionist, nursing staff, lab attendant, lab assistant, hostel warden, etc.). Signals: "vacancy", "naukri", "kaam chahiye", "hiring", "recruitment", "apply for job", "teacher post", "salary", "ctc", "stipend", "in-hand", mentioning years of work experience, attaching/asking-where-to-send a resume/CV, "walk-in interview" etc.
- VENDORS / PROCUREMENT: suppliers pitching services or asking for tenders. Signals: "quotation", "supply", "wholesale", "tie-up", "partnership", "company profile", "rate card", "GST", "invoice".
- OTHER: spam, wrong numbers, government surveys, etc.

Output ONLY valid JSON matching this schema (no prose, no markdown, no code fences):
{
  "intent": "admission" | "job" | "vendor" | "other",
  "confidence": number between 0 and 1,
  "role_inferred": string or null,         // for "job": the position they want (e.g. "teacher", "peon", "nursing tutor"). null otherwise
  "experience_years": number or null,      // for "job": years of experience if mentioned, else null
  "reasoning": string                      // ONE short sentence (max 25 words) explaining the call
}

Be conservative: if a message could plausibly be from a prospective student (even a parent asking about courses), return "admission". Only return "job" / "vendor" when the signal is clear. Hindi/Hinglish is fine — interpret it.`;

interface ClassifyResult {
  intent: "admission" | "job" | "vendor" | "other";
  confidence: number;
  role_inferred: string | null;
  experience_years: number | null;
  reasoning: string;
}

async function callGemini(content: string, apiKey: string): Promise<ClassifyResult> {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: "user", parts: [{ text: `Classify this message:\n\n${content}` }] }],
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 200,
          responseMimeType: "application/json",
        },
      }),
    },
  );

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini ${res.status}: ${errText.slice(0, 300)}`);
  }

  const data = await res.json();
  const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!raw) throw new Error("Empty Gemini response");

  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Salvage: find first {...} block
    const m = raw.match(/\{[\s\S]*\}/);
    if (!m) throw new Error(`Unparseable Gemini output: ${raw.slice(0, 200)}`);
    parsed = JSON.parse(m[0]);
  }

  const intent = String(parsed.intent || "other").toLowerCase();
  if (!["admission", "job", "vendor", "other"].includes(intent)) {
    throw new Error(`Bad intent value: ${intent}`);
  }

  return {
    intent: intent as ClassifyResult["intent"],
    confidence: Math.max(0, Math.min(1, Number(parsed.confidence ?? 0))),
    role_inferred: parsed.role_inferred ? String(parsed.role_inferred).slice(0, 100) : null,
    experience_years: parsed.experience_years != null ? Number(parsed.experience_years) : null,
    reasoning: String(parsed.reasoning || "").slice(0, 500),
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const geminiKey = Deno.env.get("GEMINI_API_KEY") || Deno.env.get("GOOGLE_AI_API_KEY");
  if (!geminiKey) {
    return new Response(JSON.stringify({ error: "GEMINI_API_KEY not configured" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey);

  try {
    const body = await req.json().catch(() => ({}));
    const queueId: string | null = body.queue_id || null;
    const dispatchReply: boolean = body.dispatch_reply === true;

    let leadId: string | null = body.lead_id || null;
    let messageId: string | null = body.message_id || null;
    let phone: string | null = body.phone || null;
    let content: string | null = body.content || null;

    // Mode A: load from queue row.
    // Concurrency: webhook fires us directly; cron fires us as a backstop
    // (only after 90s, see migration). If the row is already 'completed',
    // skip — another invocation finished. Otherwise proceed; the final CAS
    // before reply dispatch prevents duplicate replies.
    if (queueId) {
      const { data: row } = await admin
        .from("wa_classification_queue")
        .select("*")
        .eq("id", queueId)
        .maybeSingle();

      if (!row) {
        return new Response(JSON.stringify({ error: "queue row not found", queueId }), {
          status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (row.status === "completed") {
        return new Response(JSON.stringify({ skipped: true, reason: "already_completed" }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      // Mark in-flight (idempotent — not a hard lock, just for observability)
      await admin.from("wa_classification_queue")
        .update({ status: "processing", started_at: new Date().toISOString() })
        .eq("id", queueId)
        .neq("status", "completed");

      leadId = row.lead_id;
      messageId = row.message_id;
      phone = row.phone;
      content = row.content;
    }

    if (!content || content.trim().length < 3) {
      return new Response(JSON.stringify({ error: "content required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Call LLM
    let result: ClassifyResult;
    try {
      result = await callGemini(content, geminiKey);
    } catch (err: any) {
      console.error("Classify Gemini error:", err.message);
      if (queueId) {
        await admin.from("wa_classification_queue").update({
          status: "failed",
          error_message: err.message?.slice(0, 500) || "gemini error",
          completed_at: new Date().toISOString(),
        }).eq("id", queueId);
      }
      return new Response(JSON.stringify({ error: "classification failed", detail: err.message }), {
        status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Decide whether to apply
    let appliedCategory: string | null = null;
    let personRoleTarget: string | null = null;

    if (result.intent === "job" && result.confidence >= HIGH_CONFIDENCE) {
      personRoleTarget = "job_applicant";
      appliedCategory = "job_applicant";
    } else if (result.intent === "vendor" && result.confidence >= HIGH_CONFIDENCE) {
      personRoleTarget = "vendor";
      appliedCategory = "vendor";
    }

    // Apply: change person_role on the lead (trigger inserts/updates job_applicants row)
    if (personRoleTarget && leadId) {
      // Don't override manual locks
      const { data: leadRow } = await admin
        .from("leads")
        .select("person_role, category_locked")
        .eq("id", leadId)
        .single();

      if (leadRow && !leadRow.category_locked && leadRow.person_role === "lead") {
        await admin
          .from("leads")
          .update({ person_role: personRoleTarget, stage: "not_interested" })
          .eq("id", leadId)
          .eq("person_role", "lead");

        // Enrich the job_applicants row with LLM provenance
        if (personRoleTarget === "job_applicant") {
          await admin
            .from("job_applicants")
            .update({
              classification_source: "llm",
              ai_intent: result.intent,
              ai_confidence: result.confidence,
              ai_reasoning: result.reasoning,
              desired_role: result.role_inferred,
              experience_years: result.experience_years,
              source_message_id: messageId,
            })
            .eq("lead_id", leadId);
        }
      } else {
        // Lead is locked or already categorized — just record that we saw this
        appliedCategory = null;
      }
    }

    // Mark queue row done. Use a CAS — only the FIRST classifier to complete
    // wins; later duplicate runs see status='completed' and skip the reply
    // dispatch. This is what prevents the user from getting two replies in
    // the rare case where webhook + cron both fired this row.
    let wonCompletion = true;
    if (queueId) {
      const { data: completed } = await admin.from("wa_classification_queue").update({
        status: "completed",
        ai_intent: result.intent,
        ai_confidence: result.confidence,
        ai_role_inferred: result.role_inferred,
        ai_experience_years: result.experience_years,
        ai_reasoning: result.reasoning,
        applied_category: appliedCategory,
        completed_at: new Date().toISOString(),
      })
        .eq("id", queueId)
        .neq("status", "completed")
        .select("id")
        .maybeSingle();
      wonCompletion = !!completed;
    }

    // ── Fire the deferred reply ──────────────────────────────────────────────
    // Only the CAS winner dispatches, and only when the original enqueue asked
    // for it (dispatch_reply=true). whatsapp-ai-reply self-routes:
    //   person_role=job_applicant/vendor → templated handoff
    //   else → admission knowledge-base reply
    if (wonCompletion && dispatchReply && phone && content) {
      try {
        // Pull lead context + last 6 messages for conversational continuity
        let leadName: string | null = null;
        let leadStage: string | null = null;
        if (leadId) {
          const { data: leadRow } = await admin
            .from("leads")
            .select("name, stage")
            .eq("id", leadId)
            .single();
          leadName = leadRow?.name || null;
          leadStage = leadRow?.stage || null;
        }
        const { data: recent } = await admin
          .from("whatsapp_messages")
          .select("direction, content")
          .eq("phone", phone)
          .order("created_at", { ascending: false })
          .limit(6);

        await fetch(`${supabaseUrl}/functions/v1/whatsapp-ai-reply`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${serviceRoleKey}`,
          },
          body: JSON.stringify({
            phone,
            message: content,
            lead_name: leadName,
            lead_stage: leadStage,
            course_interest: null,
            recent_messages: (recent || []).reverse(),
          }),
        });
      } catch (replyErr) {
        console.error("Post-classification reply dispatch error:", replyErr);
      }
    }

    return new Response(JSON.stringify({
      ok: true,
      classification: result,
      applied_category: appliedCategory,
      lead_id: leadId,
      reply_dispatched: dispatchReply,
    }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err: any) {
    console.error("wa-classify-message error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
