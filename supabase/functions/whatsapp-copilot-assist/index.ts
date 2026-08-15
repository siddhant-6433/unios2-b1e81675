import { createClient } from "npm:@supabase/supabase-js@2";
import {
  buildTemporalContext,
  loadVerifiedAdmissionsContext,
} from "../_shared/nimt-admissions-context.ts";
import { digits, errorMessage } from "../_shared/whatsapp-channel.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const ALLOWED_ROLES = new Set(["super_admin", "campus_admin", "principal", "admission_head", "counsellor", "hr_manager"]);

type MessageRow = {
  direction?: string | null;
  content?: string | null;
  message_type?: string | null;
  created_at?: string | null;
};

type LeadRow = {
  name?: string | null;
  stage?: string | null;
  person_role?: string | null;
  courses?: { name?: string | null } | null;
};

type AssistResult = {
  summary: string;
  intent: string;
  draft_reply: string;
  next_action_label: string;
  next_action_reason: string;
  confidence: number;
  should_pause_ai: boolean;
};

function clampConfidence(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric)) return 0.5;
  return Math.max(0, Math.min(1, numeric));
}

function safeString(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function extractJson(text: string): Record<string, unknown> | null {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

function fallbackAssist(messages: MessageRow[], lead: LeadRow | null): AssistResult {
  const lastInbound = [...messages].reverse().find((m) => m.direction === "inbound" && m.content);
  const course = lead?.courses?.name || "the student's preferred course";
  return {
    summary: lastInbound?.content
      ? `Latest inbound message: ${lastInbound.content.slice(0, 180)}`
      : "No clear inbound message is available in this thread.",
    intent: lead?.person_role === "job_applicant" ? "Job/careers query" : "Admissions follow-up",
    draft_reply: `Hi ${lead?.name || "there"}, thanks for reaching out. I can help you with ${course}. Could you share what you would like to know next?`,
    next_action_label: "Review and reply",
    next_action_reason: "A counsellor should verify the context before sending.",
    confidence: 0.4,
    should_pause_ai: true,
  };
}

function normalizeAssist(value: Record<string, unknown> | null, fallback: AssistResult): AssistResult {
  if (!value) return fallback;
  return {
    summary: safeString(value.summary, fallback.summary).slice(0, 700),
    intent: safeString(value.intent, fallback.intent).slice(0, 160),
    draft_reply: safeString(value.draft_reply, fallback.draft_reply).slice(0, 1200),
    next_action_label: safeString(value.next_action_label, fallback.next_action_label).slice(0, 80),
    next_action_reason: safeString(value.next_action_reason, fallback.next_action_reason).slice(0, 240),
    confidence: clampConfidence(value.confidence),
    should_pause_ai: value.should_pause_ai === true,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const googleApiKey = Deno.env.get("GEMINI_API_KEY") || Deno.env.get("GOOGLE_AI_API_KEY");

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch((): Record<string, unknown> => ({}));
    const phone = digits(typeof body.phone === "string" ? body.phone : "");
    const leadId = typeof body.lead_id === "string" ? body.lead_id : null;
    const provider = body.provider === "plivo" || body.provider === "meta" ? body.provider : null;
    const businessPhoneNumberId = typeof body.business_phone_number_id === "string" ? body.business_phone_number_id : null;
    const businessNumber = typeof body.business_number === "string" ? digits(body.business_number) || body.business_number : null;

    if (!phone) {
      return new Response(JSON.stringify({ error: "phone required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient<Record<string, unknown>>(supabaseUrl, serviceRoleKey);
    const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", user.id);
    const hasAccess = ((roles || []) as { role?: string | null }[]).some((row) => row.role && ALLOWED_ROLES.has(row.role));
    if (!hasAccess) {
      return new Response(JSON.stringify({ error: "Forbidden" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let msgQuery = admin
      .from("whatsapp_messages")
      .select("direction,content,message_type,created_at")
      .eq("phone", phone)
      .order("created_at", { ascending: false })
      .limit(24);
    if (provider) msgQuery = msgQuery.eq("provider", provider);
    if (businessPhoneNumberId) msgQuery = msgQuery.eq("business_phone_number_id", businessPhoneNumberId);
    if (businessNumber) msgQuery = msgQuery.eq("business_phone_number", businessNumber);

    const { data: msgData, error: msgError } = await msgQuery;
    if (msgError) {
      return new Response(JSON.stringify({ error: msgError.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const messages = ((msgData || []) as MessageRow[]).reverse();
    if (messages.length === 0) {
      return new Response(JSON.stringify({ error: "No messages found for this conversation" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: leadData } = leadId
      ? await admin
        .from("leads")
        .select("name,stage,person_role,courses:course_id(name)")
        .eq("id", leadId)
        .maybeSingle()
      : { data: null };
    const lead = leadData as LeadRow | null;
    const verifiedAdmissionsContext = await loadVerifiedAdmissionsContext(admin, null, lead?.courses?.name || null);
    const fallback = fallbackAssist(messages, lead);

    if (!googleApiKey) {
      return new Response(JSON.stringify({ ...fallback, model_unavailable: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const transcript = messages
      .map((m) => {
        const who = m.direction === "inbound" ? "Student" : "UniOs";
        const text = (m.content || `[${m.message_type || "message"}]`).replace(/\s+/g, " ").trim();
        return `${who}: ${text}`;
      })
      .join("\n");

    const prompt = `You are a counsellor copilot for NIMT admissions WhatsApp conversations.

${buildTemporalContext()}

Return only compact JSON with keys: summary, intent, draft_reply, next_action_label, next_action_reason, confidence, should_pause_ai.
Rules:
- Do not claim the message was sent.
- Do not invent fees, waivers, deadlines, eligibility, or approvals.
- If the student asks about fees, include verified fee details when present in the thread/lead/course context and always include the canonical fee page: https://nimt.ac.in/admissions/fees/
- If the exact course fee is unclear, ask for course/campus while still sharing https://nimt.ac.in/admissions/fees/ and mention that counsellors can confirm the exact breakup.
- Keep draft_reply WhatsApp-ready, concise, and professional.
- If the thread involves DNC, complaints, eligibility risk, fee negotiation, job/vendor, or low certainty, set should_pause_ai true.
- If a human should call, make next_action_label a short operator action like "Call lead" or "Schedule follow-up".

Lead:
Name: ${lead?.name || "unknown"}
Stage: ${lead?.stage || "unknown"}
Role: ${lead?.person_role || "lead"}
Course: ${lead?.courses?.name || "unknown"}

${verifiedAdmissionsContext ? `Verified admissions context:\n${verifiedAdmissionsContext}\n\n` : ""}
Transcript:
${transcript}`;

    const geminiRes = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${googleApiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 500,
            response_mime_type: "application/json",
            // Extraction, not reasoning — and thinking is spent out of
            // maxOutputTokens before any JSON is emitted.
            thinkingConfig: { thinkingBudget: 0 },
          },
        }),
      },
    );

    if (!geminiRes.ok) {
      console.error("WhatsApp copilot Gemini error:", await geminiRes.text());
      return new Response(JSON.stringify({ ...fallback, model_unavailable: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const geminiData = await geminiRes.json();
    const raw = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text || "";
    const result = normalizeAssist(extractJson(raw), fallback);

    return new Response(JSON.stringify(result), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("whatsapp-copilot-assist error:", err);
    return new Response(JSON.stringify({ error: errorMessage(err, "Copilot assist failed") }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
