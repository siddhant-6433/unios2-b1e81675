/**
 * NIMT Web Chat Server
 *
 * Deno server that powers the website chat widget.
 * Handles lead creation, WebSocket chat sessions with Gemini Flash,
 * voice message transcription, and knowledge gap logging.
 *
 * Endpoints:
 *   POST /session   — Create lead + return JWT for WebSocket auth
 *   GET  /ws/chat   — WebSocket chat (requires JWT query param)
 *   GET  /health    — Health check
 *
 * Deploy: Cloud Run at chat.nimt.ac.in
 *
 * Env vars:
 *   GOOGLE_AI_API_KEY    — Gemini API key
 *   SUPABASE_URL         — Supabase project URL
 *   SUPABASE_SERVICE_KEY — Supabase service role key
 *   JWT_SECRET           — Secret for signing session JWTs
 *   ALLOWED_ORIGINS      — Comma-separated origins (default: https://nimt.ac.in,https://www.nimt.ac.in)
 *   PORT                 — HTTP port (default: 8000)
 */

import {
  NIMT_OVERVIEW,
  CAMPUS_INFO,
  COURSE_KNOWLEDGE,
  FEE_STRUCTURE,
  ADMISSIONS_INFO,
  getCourseKnowledge,
} from "./knowledge.ts";
import type {
  LeadInfo,
  SessionPayload,
  ChatMessage,
  ServerMessage,
  ActiveSession,
  KnowledgeGap,
} from "./types.ts";

// ── Config ──────────────────────────────────────────────────────────────────

const PORT = parseInt(Deno.env.get("PORT") || "8000");
const GOOGLE_AI_API_KEY = Deno.env.get("GOOGLE_AI_API_KEY") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_KEY") || "";
const JWT_SECRET = Deno.env.get("JWT_SECRET") || "nimt-web-chat-dev-secret";
const ALLOWED_ORIGINS = (Deno.env.get("ALLOWED_ORIGINS") || "https://nimt.ac.in,https://www.nimt.ac.in,http://localhost:4321").split(",");
const GEMINI_MODEL = Deno.env.get("GEMINI_MODEL") || "gemini-2.5-flash";
const GEMINI_API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:streamGenerateContent?alt=sse&key=${GOOGLE_AI_API_KEY}`;
const GEMINI_TRANSCRIBE_URL = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${GOOGLE_AI_API_KEY}`;

// ── Rate Limits ─────────────────────────────────────────────────────────────

const MAX_MESSAGES_PER_SESSION = 50;
const MAX_SESSIONS_PER_IP_PER_HOUR = 3;
const MAX_CONCURRENT_CONNECTIONS = 100;
const GEMINI_TIMEOUT_MS = 10_000;
const SESSION_EXPIRY_MS = 30 * 60 * 1000; // 30 minutes

// ── State ───────────────────────────────────────────────────────────────────

const activeSessions = new Map<string, ActiveSession>();
const ipSessionCounts = new Map<string, { count: number; resetAt: number }>();
let activeConnectionCount = 0;

// ── JWT (simple HMAC-SHA256) ────────────────────────────────────────────────

async function signJwt(payload: SessionPayload): Promise<string> {
  const header = btoa(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const body = btoa(JSON.stringify(payload));
  const data = `${header}.${body}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(JWT_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  const sigStr = btoa(String.fromCharCode(...new Uint8Array(sig)));
  return `${data}.${sigStr}`;
}

async function verifyJwt(token: string): Promise<SessionPayload | null> {
  try {
    const [header, body, sig] = token.split(".");
    if (!header || !body || !sig) return null;
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(JWT_SECRET),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
    const data = `${header}.${body}`;
    const sigBytes = Uint8Array.from(atob(sig), (c) => c.charCodeAt(0));
    const valid = await crypto.subtle.verify("HMAC", key, sigBytes, new TextEncoder().encode(data));
    if (!valid) return null;
    const payload: SessionPayload = JSON.parse(atob(body));
    if (payload.exp < Date.now() / 1000) return null;
    return payload;
  } catch {
    return null;
  }
}

// ── Course name → ID mapping ────────────────────────────────────────────────

const COURSE_ID_MAP: Record<string, string> = {
  "B.Sc Nursing": "a0000001-0000-0000-0000-000000000005",
  "GNM": "a0000001-0000-0000-0000-000000000011",
  "BPT": "a0000001-0000-0000-0000-000000000003",
  "MBA": "645e4706-93cf-4247-962e-1784d780f7c2",
  "PGDM": "cc04e489-e8a7-465e-90bd-4e21d2415a92",
  "BA LLB": "a0000001-0000-0000-0000-000000000013",
  "LLB": "cb602df7-3333-4096-b114-125433ea2666",
  "B.Ed": "a0000001-0000-0000-0000-000000000020",
  "BCA": "2a884e70-cfe9-4744-b237-5df8a27a4df1",
  "BBA": "22c83355-f439-4259-8d1f-ecf8bdf0d1f6",
  "BMRIT": "a0000001-0000-0000-0000-000000000001",
  "D Pharma": "a0000001-0000-0000-0000-000000000006",
  "DPT": "a0000001-0000-0000-0000-000000000009",
  "D-OTT": "a0000001-0000-0000-0000-000000000010",
  "MPT": "a0000001-0000-0000-0000-000000000004",
};

// ── Supabase helpers ────────────────────────────────────────────────────────

const supabaseHeaders = {
  "Content-Type": "application/json",
  apikey: SUPABASE_SERVICE_KEY,
  Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
};

function normalisePhone(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.length === 10) return `+91${digits}`;
  if (digits.startsWith("91") && digits.length === 12) return `+${digits}`;
  if (phone.startsWith("+")) return phone;
  return `+${digits}`;
}

async function createLead(lead: LeadInfo): Promise<string | null> {
  try {
    const courseId = COURSE_ID_MAP[lead.course] || null;
    const normPhone = normalisePhone(lead.mobile);
    const newSource = "website_chat";

    // Check for existing lead by phone
    const existingRes = await fetch(
      `${SUPABASE_URL}/rest/v1/leads?phone=eq.${encodeURIComponent(normPhone)}&select=id,source,secondary_source,tertiary_source,source_history&limit=1`,
      { headers: supabaseHeaders },
    );

    if (existingRes.ok) {
      const existingData = await existingRes.json();
      if (existingData.length > 0) {
        const existing = existingData[0];

        // Update source tracking if website_chat is a new source for this lead
        if (existing.source !== newSource && existing.secondary_source !== newSource && existing.tertiary_source !== newSource) {
          const updates: Record<string, unknown> = {};
          const history = Array.isArray(existing.source_history) ? existing.source_history : [];
          history.push({ source: newSource, timestamp: new Date().toISOString(), data: `Chat about ${lead.course}` });
          updates.source_history = history;

          if (!existing.secondary_source) {
            updates.secondary_source = newSource;
          } else if (!existing.tertiary_source) {
            updates.tertiary_source = newSource;
          }

          await fetch(`${SUPABASE_URL}/rest/v1/leads?id=eq.${existing.id}`, {
            method: "PATCH",
            headers: { ...supabaseHeaders, Prefer: "return=minimal" },
            body: JSON.stringify(updates),
          });

          // Log activity
          await fetch(`${SUPABASE_URL}/rest/v1/lead_activities`, {
            method: "POST",
            headers: { ...supabaseHeaders, Prefer: "return=minimal" },
            body: JSON.stringify({
              lead_id: existing.id,
              type: "system",
              description: `Lead re-inquired via website chat about ${lead.course}`,
            }),
          });
        }

        console.log(`Duplicate lead found for ${normPhone}, returning existing: ${existing.id}`);
        return existing.id;
      }
    }

    // No existing lead — create new one
    const body: Record<string, unknown> = {
      name: lead.name,
      phone: normPhone,
      source: newSource,
      stage: "new_lead",
      skip_ai_call: true,
    };
    if (courseId) body.course_id = courseId;

    const res = await fetch(`${SUPABASE_URL}/rest/v1/leads`, {
      method: "POST",
      headers: { ...supabaseHeaders, Prefer: "return=representation" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.error("Lead creation failed:", await res.text());
      return null;
    }
    const data = await res.json();
    return data[0]?.id || null;
  } catch (e) {
    console.error("Lead creation error:", e);
    return null;
  }
}

async function saveConversation(
  leadId: string,
  sessionId: string,
  messages: ActiveSession["messages"],
): Promise<void> {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/web_conversations`, {
      method: "POST",
      headers: { ...supabaseHeaders, Prefer: "return=minimal" },
      body: JSON.stringify({
        lead_id: leadId,
        session_id: sessionId,
        messages,
        started_at: new Date(messages[0]?.timestamp || Date.now()).toISOString(),
        ended_at: new Date().toISOString(),
      }),
    });
  } catch (e) {
    console.error("Save conversation error:", e);
  }
}

async function trackEngagement(leadId: string, phone: string, eventType: string, metadata?: Record<string, unknown>): Promise<void> {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/lead_engagement_events`, {
      method: "POST",
      headers: { ...supabaseHeaders, Prefer: "return=minimal" },
      body: JSON.stringify({
        lead_id: leadId,
        phone: normalisePhone(phone),
        event_type: eventType,
        metadata: metadata || {},
      }),
    });
  } catch (e) {
    console.error("Track engagement error:", e);
  }
}

async function logKnowledgeGap(gap: KnowledgeGap): Promise<void> {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/knowledge_gaps`, {
      method: "POST",
      headers: { ...supabaseHeaders, Prefer: "return=minimal" },
      body: JSON.stringify({
        query_text: gap.query_text,
        context: gap.context,
        source: gap.source,
        confidence_score: gap.confidence_score,
        status: "pending",
      }),
    });
  } catch (e) {
    console.error("Log knowledge gap error:", e);
  }
}

// ── Knowledge context builder ───────────────────────────────────────────────

function buildKnowledgeContext(course: string): string {
  const ck = getCourseKnowledge(course);
  const courseSpecific = ck
    ? `\nCourse Details for ${course}:\n` +
      `Highlights: ${ck.highlights.join("; ")}\n` +
      `Eligibility: ${ck.eligibility}\n` +
      `Entrance: ${ck.entrance}\n` +
      `Duration: ${ck.duration}\n` +
      `Campus: ${ck.campus}\n` +
      (ck.fee ? `Fee: ${ck.fee}\n` : "") +
      `Careers: ${ck.careers}\n` +
      `Practical Exposure: ${ck.practicalExposure}\n` +
      (ck.placementHighlights ? `Placement: ${ck.placementHighlights}\n` : "")
    : "";

  return `${NIMT_OVERVIEW}\n\n${FEE_STRUCTURE}\n\n${ADMISSIONS_INFO}${courseSpecific}`;
}

// ── System prompt ───────────────────────────────────────────────────────────

function buildSystemPrompt(knowledge: string, lang: string = "en"): string {
  const langInstruction = lang === "hi"
    ? "Language: Respond in Hinglish (mix of Hindi and English). Use simple, conversational language. Keep it friendly and warm."
    : "Language: Respond in clear, simple English. Keep it friendly, warm, and professional.";

  const fallbackMsg = lang === "hi"
    ? "Main yeh confirm karke batata hoon, hamari team aapko jaldi call karegi."
    : "Let me check on that — our team will get back to you shortly with the details.";

  return `You are Navya, NIMT's AI admissions counsellor on the website. You help prospective students with admission queries.

Your name is Navya. Always introduce yourself as Navya if asked.

${langInstruction}

Rules:
1. Answer questions about fees, eligibility, courses, campuses, placements, scholarships using ONLY the knowledge base below.
2. Keep responses concise — 2-3 sentences max for text chat.
3. If you don't know something or the knowledge base doesn't cover it, respond with: "${fallbackMsg}" and set confidence to 0.
4. If the student seems ready, suggest scheduling a campus visit or applying at apply.nimt.ac.in.
5. NEVER make up information. Only use the knowledge base.
6. Be warm, helpful, and encouraging.
7. For every response, include a JSON block at the very end in this exact format:
   {"confidence": 0.0 to 1.0}
   where 1.0 means you answered directly from the knowledge base, 0.5 means you inferred/partially matched, and 0.0 means no match found.

Knowledge Base:
${knowledge}`;
}

// ── Gemini streaming ────────────────────────────────────────────────────────

async function* streamGeminiResponse(
  systemPrompt: string,
  conversationHistory: { role: string; content: string }[],
  userMessage: string,
): AsyncGenerator<string> {
  const contents = [
    ...conversationHistory.map((m) => ({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text: m.content }],
    })),
    { role: "user", parts: [{ text: userMessage }] },
  ];

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);

  try {
    const res = await fetch(GEMINI_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents,
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens: 500,
        },
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error("Gemini API error:", res.status, errText);
      throw new Error(`Gemini API error: ${res.status}`);
    }

    const reader = res.body?.getReader();
    if (!reader) throw new Error("No response body");

    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (line.startsWith("data: ")) {
          const data = line.slice(6).trim();
          if (data === "[DONE]") return;
          try {
            const parsed = JSON.parse(data);
            const text = parsed?.candidates?.[0]?.content?.parts?.[0]?.text;
            if (text) yield text;
          } catch {
            // Skip unparseable chunks
          }
        }
      }
    }
  } catch (e) {
    if (e instanceof DOMException && e.name === "AbortError") {
      throw new Error("TIMEOUT");
    }
    throw e;
  } finally {
    clearTimeout(timeout);
  }
}

// ── Voice transcription ─────────────────────────────────────────────────────

async function transcribeVoice(base64Audio: string): Promise<string | null> {
  try {
    const res = await fetch(GEMINI_TRANSCRIBE_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{
          parts: [
            { text: "Transcribe this audio message. The speaker is likely speaking Hinglish (mix of Hindi and English). Return only the transcribed text, nothing else." },
            { inlineData: { mimeType: "audio/webm", data: base64Audio } },
          ],
        }],
        generationConfig: { temperature: 0.1 },
      }),
    });

    if (!res.ok) return null;
    const data = await res.json();
    return data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || null;
  } catch {
    return null;
  }
}

// ── CORS ────────────────────────────────────────────────────────────────────

function corsHeaders(origin: string | null): Record<string, string> {
  const allowed = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400",
  };
}

// ── Rate limiting ───────────────────────────────────────────────────────────

function checkIpRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = ipSessionCounts.get(ip);
  if (!entry || entry.resetAt < now) {
    ipSessionCounts.set(ip, { count: 1, resetAt: now + 3600_000 });
    return true;
  }
  if (entry.count >= MAX_SESSIONS_PER_IP_PER_HOUR) return false;
  entry.count++;
  return true;
}

// ── Phone validation ────────────────────────────────────────────────────────

function isValidIndianMobile(phone: string): boolean {
  const digits = phone.replace(/\D/g, "");
  // 10 digits starting with 6-9, or 91 + 10 digits
  return /^[6-9]\d{9}$/.test(digits) || /^91[6-9]\d{9}$/.test(digits);
}

// ── WebSocket chat handler ──────────────────────────────────────────────────

async function handleWebSocketChat(ws: WebSocket, session: SessionPayload, sessionId: string) {
  const activeSession: ActiveSession = {
    leadId: session.leadId,
    lead: session.lead,
    messages: [],
    messageCount: 0,
    createdAt: Date.now(),
    lastActivity: Date.now(),
  };
  activeSessions.set(sessionId, activeSession);
  activeConnectionCount++;

  // Track chat session start
  trackEngagement(session.leadId, session.lead.mobile, "chat_open", { course: session.lead.course });

  // Build knowledge context based on student's course interest
  const knowledge = buildKnowledgeContext(session.lead.course);
  let currentLang = "en";
  let systemPrompt = buildSystemPrompt(knowledge, currentLang);

  // Send welcome message in English
  const welcomeName = session.lead.name.split(" ")[0];
  const courseName = session.lead.course;
  const welcomeMsg: ServerMessage = {
    type: "complete",
    content: `Hi${welcomeName ? ` ${welcomeName}` : ""}! I'm Navya, NIMT's AI Counsellor. Since you're interested in ${courseName}, would you like me to share the details — eligibility, fees, placements, or anything specific?`,
    timestamp: new Date().toISOString(),
    messageId: crypto.randomUUID(),
  };
  ws.send(JSON.stringify(welcomeMsg));
  activeSession.messages.push({
    role: "assistant",
    content: welcomeMsg.content,
    timestamp: welcomeMsg.timestamp,
    type: "text",
  });

  ws.onmessage = async (event) => {
    try {
      const msg: ChatMessage = JSON.parse(event.data);
      activeSession.lastActivity = Date.now();

      // Update language if client sends it
      const msgLang = (msg as any).lang;
      if (msgLang && (msgLang === "en" || msgLang === "hi") && msgLang !== currentLang) {
        currentLang = msgLang;
        systemPrompt = buildSystemPrompt(knowledge, currentLang);
      }

      // Rate limit check
      if (activeSession.messageCount >= MAX_MESSAGES_PER_SESSION) {
        ws.send(JSON.stringify({
          type: "error",
          content: currentLang === "hi"
            ? "Aap bahut sawal puch chuke hain is session mein. Naya session shuru karne ke liye page refresh karein."
            : "You've reached the message limit for this session. Please refresh the page to start a new session.",
          timestamp: new Date().toISOString(),
        } as ServerMessage));
        return;
      }
      activeSession.messageCount++;

      let userText = msg.content;

      // Handle voice messages: transcribe first
      if (msg.type === "voice") {
        const transcript = await transcribeVoice(msg.content);
        if (!transcript) {
          ws.send(JSON.stringify({
            type: "complete",
            content: currentLang === "hi"
              ? "Aapka voice message samajh nahi aaya, kya aap type karke bhej sakte hain?"
              : "Sorry, I couldn't understand that voice message. Could you type your question instead?",
            timestamp: new Date().toISOString(),
            messageId: crypto.randomUUID(),
          } as ServerMessage));
          return;
        }
        userText = transcript;
        // Send transcription back to client
        ws.send(JSON.stringify({
          type: "system",
          content: `[Transcribed: ${transcript}]`,
          timestamp: new Date().toISOString(),
        } as ServerMessage));
      }

      // Track user message engagement
      trackEngagement(session.leadId, session.lead.mobile, "chat_message", { message_num: activeSession.messageCount });

      // Save user message
      activeSession.messages.push({
        role: "user",
        content: userText,
        timestamp: msg.timestamp || new Date().toISOString(),
        type: msg.type,
      });

      // Build conversation history (exclude system messages, limit to last 20)
      const history = activeSession.messages
        .filter((m) => m.role === "user" || m.role === "assistant")
        .slice(-20)
        .map((m) => ({ role: m.role, content: m.content }));
      // Remove the last user message since we pass it separately
      history.pop();

      // Stream Gemini response
      const messageId = crypto.randomUUID();
      let fullResponse = "";

      try {
        for await (const chunk of streamGeminiResponse(systemPrompt, history, userText)) {
          fullResponse += chunk;
          ws.send(JSON.stringify({
            type: "chunk",
            content: chunk,
            timestamp: new Date().toISOString(),
            messageId,
          } as ServerMessage));
        }
      } catch (e) {
        if (e instanceof Error && e.message === "TIMEOUT") {
          const fallback = currentLang === "hi"
            ? "Hamara system abhi busy hai. Aapko jaldi callback mil jayega. Kuch aur help chahiye?"
            : "I'm taking a moment to process. You'll receive a callback shortly. Is there anything else I can help with?";
          ws.send(JSON.stringify({
            type: "complete",
            content: fallback,
            timestamp: new Date().toISOString(),
            messageId,
          } as ServerMessage));
          fullResponse = fallback;
        } else {
          console.error("Gemini streaming error:", e);
          const fallback = currentLang === "hi"
            ? "Kuch technical issue aa raha hai. Aap hamein +91 9555192192 par call kar sakte hain."
            : "I'm experiencing a temporary issue. You can reach us at +91 9555192192 for immediate assistance.";
          ws.send(JSON.stringify({
            type: "complete",
            content: fallback,
            timestamp: new Date().toISOString(),
            messageId,
          } as ServerMessage));
          fullResponse = fallback;
        }
      }

      // Send completion marker
      ws.send(JSON.stringify({
        type: "complete",
        content: "",
        timestamp: new Date().toISOString(),
        messageId,
      } as ServerMessage));

      // Parse confidence from response
      const confidenceMatch = fullResponse.match(/\{"confidence":\s*([\d.]+)\}/);
      const confidence = confidenceMatch ? parseFloat(confidenceMatch[1]) : 0.5;

      // Clean response (remove confidence JSON from display)
      const cleanResponse = fullResponse.replace(/\{"confidence":\s*[\d.]+\}/, "").trim();

      // Save assistant message
      activeSession.messages.push({
        role: "assistant",
        content: cleanResponse,
        timestamp: new Date().toISOString(),
        type: "text",
      });

      // Log knowledge gap if low confidence
      if (confidence < 0.6) {
        logKnowledgeGap({
          query_text: userText,
          context: {
            course: activeSession.lead.course,
            lead_id: activeSession.leadId,
          },
          source: "web_chat",
          confidence_score: confidence,
        });
      }
    } catch (e) {
      console.error("Message handling error:", e);
    }
  };

  ws.onclose = async () => {
    activeConnectionCount--;
    // Save conversation to Supabase
    if (activeSession.messages.length > 1) {
      await saveConversation(activeSession.leadId, sessionId, activeSession.messages);
    }
    activeSessions.delete(sessionId);
  };

  ws.onerror = (e) => {
    console.error("WebSocket error:", e);
  };
}

// ── HTTP handler ────────────────────────────────────────────────────────────

async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const origin = req.headers.get("Origin");

  // CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }

  // Health check
  if (url.pathname === "/health") {
    return new Response(
      JSON.stringify({
        status: "ok",
        connections: activeConnectionCount,
        sessions: activeSessions.size,
      }),
      { headers: { "Content-Type": "application/json", ...corsHeaders(origin) } },
    );
  }

  // POST /session — Create lead and return JWT
  if (url.pathname === "/session" && req.method === "POST") {
    const ip = req.headers.get("X-Forwarded-For")?.split(",")[0]?.trim() ||
      req.headers.get("CF-Connecting-IP") || "unknown";

    if (!checkIpRateLimit(ip)) {
      return new Response(
        JSON.stringify({ error: "Too many sessions. Please try again later." }),
        { status: 429, headers: { "Content-Type": "application/json", ...corsHeaders(origin) } },
      );
    }

    try {
      const body = await req.json();
      const { name, mobile, course } = body as LeadInfo;

      // Validate
      if (!name || name.trim().length < 2) {
        return new Response(
          JSON.stringify({ error: "Please provide your name." }),
          { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders(origin) } },
        );
      }
      if (!mobile || !isValidIndianMobile(mobile)) {
        return new Response(
          JSON.stringify({ error: "Please provide a valid Indian mobile number." }),
          { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders(origin) } },
        );
      }
      if (!course || course.trim().length < 2) {
        return new Response(
          JSON.stringify({ error: "Please select a course." }),
          { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders(origin) } },
        );
      }

      // Sanitize inputs (prevent prompt injection in lead data)
      const sanitizedName = name.trim().slice(0, 100).replace(/[^\w\s.'-]/g, "");
      const sanitizedCourse = course.trim().slice(0, 100);
      const lead: LeadInfo = { name: sanitizedName, mobile: mobile.trim(), course: sanitizedCourse };

      // Create lead in CRM
      const leadId = await createLead(lead);
      if (!leadId) {
        return new Response(
          JSON.stringify({ error: "Could not create your profile. Please try again." }),
          { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders(origin) } },
        );
      }

      // Generate JWT
      const now = Math.floor(Date.now() / 1000);
      const token = await signJwt({
        leadId,
        lead,
        iat: now,
        exp: now + 1800, // 30 minutes
      });

      return new Response(
        JSON.stringify({ token, leadId }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders(origin) } },
      );
    } catch (e) {
      console.error("Session creation error:", e);
      return new Response(
        JSON.stringify({ error: "Invalid request." }),
        { status: 400, headers: { "Content-Type": "application/json", ...corsHeaders(origin) } },
      );
    }
  }

  // WebSocket upgrade: GET /ws/chat?token=<JWT>
  if (url.pathname === "/ws/chat") {
    const token = url.searchParams.get("token");
    if (!token) {
      return new Response("Missing token", { status: 401 });
    }

    const session = await verifyJwt(token);
    if (!session) {
      return new Response("Invalid or expired token", { status: 401 });
    }

    if (activeConnectionCount >= MAX_CONCURRENT_CONNECTIONS) {
      return new Response("Server busy. Please try again later.", { status: 503 });
    }

    const { socket, response } = Deno.upgradeWebSocket(req);
    const sessionId = crypto.randomUUID();

    socket.onopen = () => {
      handleWebSocketChat(socket, session, sessionId);
    };

    return response;
  }

  // Serve tracker.js
  if (url.pathname === "/tracker.js") {
    try {
      const js = await Deno.readTextFile(new URL("./tracker.js", import.meta.url).pathname);
      return new Response(js, {
        headers: {
          "Content-Type": "application/javascript",
          "Cache-Control": "public, max-age=3600",
          "Access-Control-Allow-Origin": "*",
        },
      });
    } catch {
      return new Response("Not found", { status: 404 });
    }
  }

  return new Response("Not found", { status: 404, headers: corsHeaders(origin) });
}

// ── Session cleanup (every 5 minutes) ───────────────────────────────────────

setInterval(() => {
  const now = Date.now();
  for (const [id, session] of activeSessions) {
    if (now - session.lastActivity > SESSION_EXPIRY_MS) {
      activeSessions.delete(id);
      activeConnectionCount = Math.max(0, activeConnectionCount - 1);
    }
  }
  // Clean old IP rate limit entries
  for (const [ip, entry] of ipSessionCounts) {
    if (entry.resetAt < now) ipSessionCounts.delete(ip);
  }
}, 5 * 60 * 1000);

// ── Start ───────────────────────────────────────────────────────────────────

console.log(`NIMT Web Chat Server starting on port ${PORT}`);
Deno.serve({ port: PORT }, handler);
