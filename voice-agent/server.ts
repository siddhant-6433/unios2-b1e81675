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
import {
  mulawBase64ToPcm16, pcm16ToMulawBase64, rmsEnergy,
  sarvamSTT, sarvamTTS, detectSarvamLanguageCode,
} from "./sarvam.ts";
import { elevenLabsTTS } from "./elevenlabs.ts";

const PORT = parseInt(Deno.env.get("PORT") || "8000");
const GOOGLE_AI_API_KEY = Deno.env.get("GOOGLE_AI_API_KEY") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_KEY") || "";
// Key for calling Supabase Edge Functions — VOICE_AGENT_KEY is a dedicated shared secret
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("VOICE_AGENT_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || SUPABASE_SERVICE_KEY;
// ⚠️  DO NOT swap to gemini-3.1-flash-live-preview or any *-flash-live-preview
// variant. They connect, return setupComplete, transcribe caller audio — and
// then close with WS 1008 ("Operation is not implemented") the moment Gemini
// is asked to GENERATE audio. They are text/half-cascade only.
// The native-audio model below supports audio in AND audio out via
// BidiGenerateContent. Confirmed via Cloud Run logs, April 2026.
const GEMINI_MODEL = "gemini-2.5-flash-native-audio-latest";

/** Placeholder names that indicate the real name is unknown */
const PLACEHOLDER_NAMES = new Set([
  "callback request", "callback", "applicant", "justdial user",
  "justdial lead", "website user", "student", "enquiry",
  "collegedunia user", "collegehai user", "shiksha user",
  "unknown", "test", "user", "lead",
]);

const GEMINI_WS_URL = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${GOOGLE_AI_API_KEY}`;

// In-memory store for active call contexts (call_id → context)
interface ActiveCall extends CallContext {
  leadId?: string;
  callLogId?: string;
  callerTranscript: string[];
  aiTranscript: string[];
  toolCallsMade: { name: string; args: any; result: any }[];
  plivoCallUuid?: string;
  // Quality-metric instrumentation. Each gets stamped exactly once at the
  // first relevant event so we can later compute time-to-first-audio,
  // mean turn latency, etc. and persist via finalizeQualityMetrics().
  callStartedAtMs?: number;       // Plivo stream `start` event
  firstAudioSentAtMs?: number;    // first agent audio packet shipped to Plivo
  userTurnEndAtMsList?: number[]; // each timestamp the caller stopped speaking (VAD)
  agentTurnStartAtMsList?: number[]; // matching agent-started timestamps
  voiceSwitchCount?: number;      // cascade EL→Sarvam fallbacks during this call
  agentProvider?: "gemini-live" | "cascade"; // which path was used end-to-end
}
const activeCallContexts = new Map<string, ActiveCall>();

/**
 * Execute a tool call from Gemini against Supabase.
 */
const MIRAI_CAMPUS_ID = "c0000002-0000-0000-0000-000000000001";
const BEACON_CAMPUS_ID = "9bb6b4cc-c992-4af1-b9d3-384537a510c8";

/**
 * Assigns a lead to a counsellor via round-robin within the appropriate team:
 *   Mirai campus            → "Mirai Admissions"
 *   Beacon / school campus  → "NSAE II Admissions"
 *   Education department    → "Grn BEd Admissions"
 *   Law department          → "Grn Law Admissions"
 *   Management department   → "Grn Mgmt Faculty Admissions"
 *   Anything else / fallback → "Grn Counselling"
 *
 * Skips if the lead already has a counsellor assigned.
 * Notifies the assigned counsellor (in-app notification + activity feed).
 * Returns the assigned profile id or null.
 */
async function assignLeadRoundRobin(leadId: string): Promise<string | null> {
  const h = {
    "Content-Type": "application/json",
    apikey: SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
  };

  const ldRes = await fetch(
    `${SUPABASE_URL}/rest/v1/leads?id=eq.${leadId}&select=id,name,counsellor_id,campus_id,course_id,campuses:campus_id(institutions:institution_id(type)),courses:course_id(department_id,departments:department_id(name))`,
    { headers: h },
  );
  const ld = (await ldRes.json().catch(() => []))?.[0];
  if (!ld) return null;
  if (ld.counsellor_id) return ld.counsellor_id; // already assigned — skip

  const instType = (ld.campuses as any)?.institutions?.type;
  const dept = ((ld.courses as any)?.departments as any)?.name || "";

  let teamName = "Grn Counselling";
  if (ld.campus_id === MIRAI_CAMPUS_ID) {
    teamName = "Mirai Admissions";
  } else if (ld.campus_id === BEACON_CAMPUS_ID || instType === "school") {
    teamName = "NSAE II Admissions";
  } else if (dept === "Education") {
    teamName = "Grn BEd Admissions";
  } else if (dept === "Law") {
    teamName = "Grn Law Admissions";
  } else if (dept === "Management") {
    teamName = "Grn Mgmt Faculty Admissions";
  }

  async function fetchTeamMembers(name: string): Promise<string[]> {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/teams?name=eq.${encodeURIComponent(name)}&select=id,team_members(user_id)&limit=1`,
      { headers: h },
    );
    const t = (await r.json().catch(() => []))?.[0];
    return (t?.team_members || []).map((m: any) => m.user_id);
  }

  let memberUserIds = await fetchTeamMembers(teamName);
  if (memberUserIds.length === 0 && teamName !== "Grn Counselling") {
    console.warn(`[RoundRobin] Team "${teamName}" missing/empty for lead ${leadId} — falling back to Grn Counselling`);
    teamName = "Grn Counselling";
    memberUserIds = await fetchTeamMembers(teamName);
  }
  if (memberUserIds.length === 0) {
    // All named teams are empty/missing — fall back to the DB function which
    // picks from any counsellor in the system (no team scoping required).
    console.warn(`[RoundRobin] All teams empty for lead ${leadId} — falling back to DB fn_round_robin_assign_counsellor`);
    try {
      const rpcRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/fn_round_robin_assign_counsellor`, {
        method: "POST",
        headers: { ...h, "Content-Type": "application/json" },
        body: JSON.stringify({ _lead_id: leadId }),
      });
      const assignedProfileId: string | null = await rpcRes.json().catch(() => null);
      if (assignedProfileId) {
        console.log(`[RoundRobin] DB fallback assigned profile ${assignedProfileId} to lead ${leadId}`);
        return assignedProfileId;
      }
    } catch (e) {
      console.error(`[RoundRobin] DB fallback failed for lead ${leadId}:`, e);
    }
    return null;
  }

  const profRes = await fetch(
    `${SUPABASE_URL}/rest/v1/profiles?user_id=in.(${memberUserIds.join(",")})&select=id,user_id,display_name`,
    { headers: h },
  );
  const profiles: { id: string; user_id: string; display_name: string }[] = await profRes.json().catch(() => []);
  if (profiles.length === 0) return null;
  const profileIds = profiles.map(p => p.id);

  // Round-robin: pick counsellor with fewest active leads
  const lcRes = await fetch(
    `${SUPABASE_URL}/rest/v1/leads?counsellor_id=in.(${profileIds.join(",")})&stage=not.in.(admitted,rejected,not_interested,ineligible,dnc)&select=counsellor_id`,
    { headers: h },
  );
  const activeLeads: { counsellor_id: string }[] = await lcRes.json().catch(() => []);
  const countMap: Record<string, number> = {};
  for (const pid of profileIds) countMap[pid] = 0;
  for (const l of activeLeads) {
    if (countMap[l.counsellor_id] !== undefined) countMap[l.counsellor_id]++;
  }
  const chosen = profiles.slice().sort((a, b) => (countMap[a.id] || 0) - (countMap[b.id] || 0))[0];
  if (!chosen) return null;

  await fetch(`${SUPABASE_URL}/rest/v1/leads?id=eq.${leadId}`, {
    method: "PATCH",
    headers: { ...h, Prefer: "return=minimal" },
    body: JSON.stringify({ counsellor_id: chosen.id, stage: "counsellor_call" }),
  });

  // Notify the assigned counsellor (in-app feed). notifications.user_id FKs auth.users(id),
  // so we pass profiles.user_id — NOT profiles.id.
  fetch(`${SUPABASE_URL}/rest/v1/notifications`, {
    method: "POST",
    headers: { ...h, Prefer: "return=minimal" },
    body: JSON.stringify({
      user_id: chosen.user_id,
      type: "lead_assigned",
      title: `New lead assigned: ${ld.name || "Unknown"}`,
      body: `Auto-assigned from AI call (${teamName}). Follow up soon.`,
      link: `/admissions/${leadId}`,
      lead_id: leadId,
    }),
  }).catch(() => {});
  fetch(`${SUPABASE_URL}/rest/v1/lead_activities`, {
    method: "POST",
    headers: { ...h, Prefer: "return=minimal" },
    body: JSON.stringify({
      lead_id: leadId,
      type: "system",
      description: `Auto-assigned to ${chosen.display_name} (${teamName}) after AI call`,
    }),
  }).catch(() => {});

  console.log(`[RoundRobin] Lead ${leadId} → team "${teamName}", counsellor ${chosen.display_name} (${chosen.id})`);

  fireAutomation("lead_assigned", leadId).catch(() => {});

  return chosen.id;
}

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

// ── Post-call reconciliation helpers ─────────────────────────────────

/** Extract a visit date from the AI transcript lines. Returns YYYY-MM-DD or null. */
function extractVisitDateFromTranscript(aiLines: string[]): string | null {
  const text = aiLines.join(" ").toLowerCase();

  // 1) ISO date YYYY-MM-DD
  const isoMatch = text.match(/(\d{4}-\d{2}-\d{2})/);
  if (isoMatch) return isoMatch[1];

  // 2) DD/MM/YYYY or DD-MM-YYYY
  const ddmm = text.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
  if (ddmm) return `${ddmm[3]}-${ddmm[2].padStart(2, "0")}-${ddmm[1].padStart(2, "0")}`;

  // 3) Relative: kal/tomorrow → +1, parso/day after → +2
  const now = new Date();
  if (/\b(kal|tomorrow)\b/.test(text)) {
    const d = new Date(now.getTime() + 24 * 60 * 60 * 1000);
    return d.toISOString().slice(0, 10);
  }
  if (/\b(parso|parson|day after)\b/.test(text)) {
    const d = new Date(now.getTime() + 48 * 60 * 60 * 1000);
    return d.toISOString().slice(0, 10);
  }

  // 4) Day names (English + Hindi)
  const dayMap: Record<string, number> = {
    sunday: 0, somvar: 1, monday: 1, mangalvar: 2, tuesday: 2,
    budhvar: 3, wednesday: 3, guruvar: 4, thursday: 4,
    shukravar: 5, friday: 5, shanivar: 6, saturday: 6,
  };
  for (const [word, target] of Object.entries(dayMap)) {
    if (text.includes(word)) {
      const today = now.getDay();
      let diff = target - today;
      if (diff <= 0) diff += 7;
      const d = new Date(now.getTime() + diff * 24 * 60 * 60 * 1000);
      return d.toISOString().slice(0, 10);
    }
  }

  return null;
}

/**
 * Parse a callback time out of a free-text transcript ("after 4 PM today",
 * "kal subah", "shaam ko 6 baje", "in 2 hours", etc.). Returns an ISO 8601
 * datetime in Asia/Kolkata, or null if no clear time can be extracted.
 *
 * Used by reconcilePostCall as a fallback when the AI captured a callback
 * promise in conversation but didn't pass followup_date to the disposition
 * tool. Conservative — only returns a time when the regex match is high
 * confidence; ambiguous text yields null and the caller falls back to a
 * generic "+30min" so the operator at least sees a follow-up.
 */
function extractCallbackTimeFromTranscript(text: string): string | null {
  if (!text) return null;
  const lc = text.toLowerCase();

  // ── Build today/tomorrow anchors in IST ──
  const istOffsetMs = 5.5 * 60 * 60 * 1000;
  const nowUtc = Date.now();
  const istNow = new Date(nowUtc + istOffsetMs);
  const istTodayY = istNow.getUTCFullYear();
  const istTodayM = istNow.getUTCMonth();
  const istTodayD = istNow.getUTCDate();
  const istTodayHour = istNow.getUTCHours();

  /** Build an ISO timestamp for IST date+hour+minute. */
  const istIso = (y: number, m: number, d: number, hh: number, mm = 0): string => {
    // Convert IST wall-clock back to UTC by subtracting the IST offset, then
    // append the IST timezone marker so consumers parse it back to the same
    // wall-clock time.
    const utcMs = Date.UTC(y, m, d, hh, mm) - istOffsetMs;
    const dt = new Date(utcMs);
    const pad = (n: number) => n.toString().padStart(2, "0");
    return `${y}-${pad(m + 1)}-${pad(d)}T${pad(hh)}:${pad(mm)}:00+05:30`;
  };

  // Day-of-part defaults (used when "morning / afternoon / evening" is mentioned)
  const partOfDayHour = (s: string): number | null => {
    if (/\b(morning|subah|subha)\b/.test(s)) return 10;
    if (/\b(afternoon|dopahar|noon)\b/.test(s)) return 14;
    if (/\b(evening|shaam|sham)\b/.test(s)) return 17;
    if (/\b(night|raat)\b/.test(s)) return 19;
    return null;
  };

  // ── 1. Explicit clock time + same-day or tomorrow context ──
  // "after 4 pm today", "8 baje shaam ko", "16:00 kal", "9 am tomorrow"
  const clockRe = /\b(\d{1,2})(?::(\d{2}))?\s*(am|pm|a\.m\.|p\.m\.)?\b/i;
  const dayCtxRe = /\b(today|aaj|tomorrow|kal|parso|day after)\b/;

  const ctxMatch = lc.match(dayCtxRe);
  const clockMatch = lc.match(clockRe);

  if (clockMatch) {
    let hh = parseInt(clockMatch[1], 10);
    const mm = clockMatch[2] ? parseInt(clockMatch[2], 10) : 0;
    const ampm = (clockMatch[3] || "").replace(/\./g, "").toLowerCase();
    if (hh >= 0 && hh <= 23 && mm >= 0 && mm < 60) {
      // Disambiguate AM/PM: if explicit, trust it; else assume PM for hours
      // 1-11 unless the surrounding text mentions morning/subah.
      if (ampm === "pm" && hh < 12) hh += 12;
      else if (ampm === "am" && hh === 12) hh = 0;
      else if (!ampm && hh >= 1 && hh <= 11) {
        const isMorning = /\b(morning|subah|subha|am)\b/.test(lc);
        if (!isMorning) hh += 12;
      }

      let y = istTodayY, m = istTodayM, d = istTodayD;
      if (ctxMatch) {
        const ctx = ctxMatch[1];
        if (/tomorrow|kal/.test(ctx)) {
          const t = new Date(Date.UTC(istTodayY, istTodayM, istTodayD + 1));
          y = t.getUTCFullYear(); m = t.getUTCMonth(); d = t.getUTCDate();
        } else if (/parso|day after/.test(ctx)) {
          const t = new Date(Date.UTC(istTodayY, istTodayM, istTodayD + 2));
          y = t.getUTCFullYear(); m = t.getUTCMonth(); d = t.getUTCDate();
        }
      } else {
        // No day context — if the requested clock time has already passed
        // today (in IST), bump to tomorrow.
        if (hh < istTodayHour) {
          const t = new Date(Date.UTC(istTodayY, istTodayM, istTodayD + 1));
          y = t.getUTCFullYear(); m = t.getUTCMonth(); d = t.getUTCDate();
        }
      }
      return istIso(y, m, d, hh, mm);
    }
  }

  // ── 2. "after N hours / minutes" relative — handles both English and
  // Hindi/Hinglish phrasings: "in 2 hours", "after 30 minutes", "baad mein
  // 30 minutes", "30 minutes mein", "do ghante mein".
  const relUnit = "(hour|hr|hrs|hours|minute|min|mins|minutes|ghante|ghanta|minat)";
  const relRegexes = [
    new RegExp(`\\b(?:in|after|baad)(?:\\s+mein)?\\s+(\\d{1,2})\\s*${relUnit}\\b`, "i"),
    new RegExp(`\\b(\\d{1,2})\\s*${relUnit}\\s+(?:mein|me|baad)\\b`, "i"),
  ];
  for (const re of relRegexes) {
    const m = lc.match(re);
    if (m) {
      const n = parseInt(m[1], 10);
      const unit = m[2];
      const ms = /min|minat/.test(unit) ? n * 60 * 1000 : n * 60 * 60 * 1000;
      return new Date(Date.now() + ms).toISOString();
    }
  }

  // ── 3. "tomorrow" / "kal" + part-of-day, no specific clock time ──
  if (/\b(tomorrow|kal)\b/.test(lc)) {
    const hh = partOfDayHour(lc) ?? 10;
    const t = new Date(Date.UTC(istTodayY, istTodayM, istTodayD + 1));
    return istIso(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate(), hh);
  }

  // ── 4. Same-day part-of-day ("call me in the evening" etc.) ──
  const part = partOfDayHour(lc);
  if (part !== null) {
    let y = istTodayY, m = istTodayM, d = istTodayD;
    if (part <= istTodayHour) {
      // That part has already passed today; bump to tomorrow.
      const t = new Date(Date.UTC(istTodayY, istTodayM, istTodayD + 1));
      y = t.getUTCFullYear(); m = t.getUTCMonth(); d = t.getUTCDate();
    }
    return istIso(y, m, d, part);
  }

  return null;
}

/** Detect promises made in the AI transcript and cross-reference with tools actually called. */
interface ReconcileResult {
  templateKey: string;
  templateParams: string[];
  buttonUrls?: string[];
  phone?: string;
  actions: string[]; // what reconciliation did, for logging
}

/**
 * Build the auto-computed quality_metrics JSONB blob persisted to
 * ai_call_records at hangup. Pure function over the recorded
 * timestamps + transcripts on ActiveCall — null when there isn't
 * enough data to compute anything (e.g., call dropped before first
 * audio).
 *
 * Repetition detection is intentionally simple: count how many distinct
 * agent turns asked one of the canonical first-touch questions
 * (name / course / "Aap kis ...") more than once. Catches the most
 * obvious failure mode without needing semantic similarity.
 */
function finalizeQualityMetrics(callCtx: ActiveCall): Record<string, unknown> | null {
  if (!callCtx.callStartedAtMs) return null;
  const ai = callCtx.aiTranscript || [];
  const user = callCtx.callerTranscript || [];

  const turnLatencies: number[] = [];
  const userEnds = callCtx.userTurnEndAtMsList || [];
  const agentStarts = callCtx.agentTurnStartAtMsList || [];
  const pairCount = Math.min(userEnds.length, agentStarts.length);
  for (let i = 0; i < pairCount; i++) {
    const lat = agentStarts[i] - userEnds[i];
    if (lat >= 0 && lat < 30000) turnLatencies.push(lat); // sanity bound
  }
  const meanTurnLatency = turnLatencies.length
    ? Math.round(turnLatencies.reduce((a, b) => a + b, 0) / turnLatencies.length)
    : null;

  // Repetition heuristic — same canonical question asked ≥2 times.
  const repetitionPatterns: Array<[string, RegExp]> = [
    ["ask_name",   /aapk[ai]\s+naam|what.*your\s+name/i],
    ["ask_course", /kis\s+course|kya\s+course|which\s+course|kis\s+program/i],
    ["ask_grad",   /graduation\s+(complete|done|kar\s+li)/i],
    ["ask_12th",   /(12th|twelfth).*(complete|done|kar\s+li|pass)/i],
    ["ask_hostel", /hostel.*(chah|need|preference)/i],
  ];
  let repetitionCount = 0;
  const repeatedPatterns: string[] = [];
  for (const [name, rx] of repetitionPatterns) {
    const hits = ai.filter(t => rx.test(t)).length;
    if (hits >= 2) {
      repetitionCount += hits - 1; // every extra ask counts
      repeatedPatterns.push(name);
    }
  }

  const dispositionSet = (callCtx.toolCallsMade || []).some(
    tc => tc.name === "set_call_disposition" && tc.result?.success !== false,
  );

  return {
    schema_version: 1,
    provider: callCtx.agentProvider || "unknown",
    direction: callCtx.direction,
    total_turns: ai.length,
    user_turns: user.length,
    time_to_first_audio_ms: callCtx.firstAudioSentAtMs && callCtx.callStartedAtMs
      ? callCtx.firstAudioSentAtMs - callCtx.callStartedAtMs
      : null,
    mean_turn_latency_ms: meanTurnLatency,
    measured_turn_pairs: turnLatencies.length,
    repetition_count: repetitionCount,
    repeated_patterns: repeatedPatterns,
    voice_switch_count: callCtx.voiceSwitchCount || 0,
    disposition_set: dispositionSet,
    tool_calls_made: (callCtx.toolCallsMade || []).map(tc => tc.name),
  };
}

async function reconcilePostCall(
  callCtx: ActiveCall | null,
  leadId: string,
  dbDisposition: string | null,
  dbHeaders: Record<string, string>,
): Promise<ReconcileResult | null> {
  const aiLines = callCtx?.aiTranscript || [];
  const callerLines = callCtx?.callerTranscript || [];
  const toolsMade = callCtx?.toolCallsMade || [];
  const aiText = aiLines.join(" ").toLowerCase();
  const callerText = callerLines.join(" ").toLowerCase();
  const actions: string[] = [];

  // Determine disposition from tools or DB
  const disposition = toolsMade.find(tc => tc.name === "set_call_disposition")?.args?.disposition
    || dbDisposition;

  // Check which tools succeeded
  const visitDone = toolsMade.some(tc => tc.name === "schedule_visit" && tc.result?.success === true);
  const callbackDone = toolsMade.some(tc => tc.name === "request_human_callback" && tc.result?.success === true);
  const waSent = toolsMade.some(tc => tc.name === "send_whatsapp_to_lead" && tc.result?.success === true);

  // Detect promises from AI transcript
  const visitPromised = /visit\s*(schedule|book|confirm|kar)|campus\s*(visit|dekhne)|aap\s*aa\s*sakte|aapka\s*visit|appointment\s*(book|schedule)/.test(aiText);
  const callbackPromised = /senior\s*counsel|human\s*counsel|callback|call\s*back|koi\s*aapko\s*call|team\s*se\s*baat|expert\s*se\s*connect/.test(aiText);
  const waPromised = /whatsapp\s*(par|pe)?\s*(bhej|send)|bhej\s*deti|link\s*bhej|send\s*you.*whatsapp|aapko\s*bhej|details\s*bhej|message\s*bhej/.test(aiText);

  // Check for caller affirmation near visit promise (to avoid false positives)
  const callerAffirmed = /\b(haan|ha+n|yes|ok|okay|theek|thik|sure|bilkul|zaroor|done|chalega)\b/.test(callerText);

  // ── Reconcile unfulfilled promises ──

  // 1. Visit promised + caller affirmed but schedule_visit not called → create visit
  if (visitPromised && callerAffirmed && !visitDone) {
    const visitDate = extractVisitDateFromTranscript(aiLines) || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const visitTime = /\bmorning|subah\b/.test(aiText) ? "morning" : /\bafternoon|dopahar\b/.test(aiText) ? "afternoon" : /\bevening|shaam\b/.test(aiText) ? "evening" : "morning";
    const timeMap: Record<string, string> = { morning: "10:00", afternoon: "14:00", evening: "16:00" };
    const visitTimestamp = `${visitDate}T${timeMap[visitTime]}:00+05:30`;

    // Get campus_id from lead
    const ldRes = await fetch(`${SUPABASE_URL}/rest/v1/leads?id=eq.${leadId}&select=campus_id`, { headers: dbHeaders });
    const ldData = await ldRes.json();
    const campusId = ldData?.[0]?.campus_id || null;

    // Dedup: check recent visits
    const dedupRes = await fetch(
      `${SUPABASE_URL}/rest/v1/campus_visits?lead_id=eq.${leadId}&status=eq.scheduled&created_at=gte.${new Date(Date.now() - 300000).toISOString()}&select=id&limit=1`,
      { headers: dbHeaders },
    );
    const dedupRows = await dedupRes.json().catch(() => []);
    if (!dedupRows?.length) {
      const visitBody: Record<string, any> = { lead_id: leadId, visit_date: visitTimestamp, status: "scheduled" };
      if (campusId) visitBody.campus_id = campusId;
      const vRes = await fetch(`${SUPABASE_URL}/rest/v1/campus_visits`, {
        method: "POST", headers: { ...dbHeaders, Prefer: "return=minimal" }, body: JSON.stringify(visitBody),
      });
      if (vRes.ok) {
        actions.push(`visit_created:${visitDate}`);
        // Update lead stage
        await fetch(`${SUPABASE_URL}/rest/v1/leads?id=eq.${leadId}`, {
          method: "PATCH", headers: { ...dbHeaders, Prefer: "return=minimal" },
          body: JSON.stringify({ stage: "visit_scheduled" }),
        });
        await fetch(`${SUPABASE_URL}/rest/v1/lead_notes`, {
          method: "POST", headers: { ...dbHeaders, Prefer: "return=minimal" },
          body: JSON.stringify({ lead_id: leadId, content: `🤖 Post-call reconciliation: Campus visit created for ${visitDate} (${visitTime}). AI promised but didn't call schedule_visit.` }),
        });
        await assignLeadRoundRobin(leadId);
        fireAutomation("visit_scheduled", leadId);
      }
    }
  }

  // 2. Callback promised but no followup landed at a specific time → create one.
  // Distinguish AI callback (caller was busy, wants Navya to retry) vs human
  // callback (caller asked for a senior counsellor / specialist) by scanning
  // the transcript for human-counsellor signals. Default = ai_callback.
  if (callbackPromised && !callbackDone) {
    const fullText = aiText + " " + callerText;
    const extractedAt = extractCallbackTimeFromTranscript(fullText);
    const fallbackAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    const scheduledAt = extractedAt || fallbackAt;
    const wantsHuman = /senior\s*counsel|human\s*counsel|human\s*agent|expert\s*se|kisi\s*senior|specialist|counsell?or\s*se\s*baat/i.test(fullText);
    const followupType = wantsHuman ? "human_callback" : "ai_callback";
    const emoji = wantsHuman ? "👤" : "🤖";
    const kindLabel = wantsHuman ? "Human-counsellor callback" : "AI callback";
    const reasonNote = extractedAt
      ? `${emoji} Post-call reconciliation: ${kindLabel} created from transcript-extracted time (${scheduledAt}).`
      : `${emoji} Post-call reconciliation: ${kindLabel} created at +30min — no specific time was mentioned in the conversation.`;

    await fetch(`${SUPABASE_URL}/rest/v1/lead_followups`, {
      method: "POST", headers: { ...dbHeaders, Prefer: "return=minimal" },
      body: JSON.stringify({
        lead_id: leadId, scheduled_at: scheduledAt,
        type: followupType, notes: reasonNote, status: "pending",
      }),
    });
    await fetch(`${SUPABASE_URL}/rest/v1/lead_notes`, {
      method: "POST", headers: { ...dbHeaders, Prefer: "return=minimal" },
      body: JSON.stringify({ lead_id: leadId, content: reasonNote }),
    });
    await assignLeadRoundRobin(leadId);
    actions.push(extractedAt ? `${followupType}_created:${scheduledAt}` : `${followupType}_created`);
  }

  // ── Determine WhatsApp template (priority: visit > callback > course_info) ──
  if (waSent) {
    // AI already sent a WhatsApp during the call — only log reconciliation actions
    if (actions.length > 0) {
      return { templateKey: "", templateParams: [], actions };
    }
    return null;
  }

  // Fetch lead info for WA params (pulls video_url for the post-summary template)
  const waLeadRes = await fetch(
    `${SUPABASE_URL}/rest/v1/leads?id=eq.${leadId}&select=phone,name,courses:course_id(name,slug,video_url),campuses:campus_id(name)`,
    { headers: dbHeaders },
  );
  const waLd = (await waLeadRes.json())?.[0];
  if (!waLd?.phone) {
    return actions.length > 0 ? { templateKey: "", templateParams: [], actions } : null;
  }

  const cn = (waLd.courses as any)?.name || "our programmes";
  const cs = (waLd.courses as any)?.slug || "";
  const cm = (waLd.campuses as any)?.name || "NIMT campus";
  const courseLink = cs ? `https://www.nimt.ac.in/courses/${cs}` : "https://www.nimt.ac.in/courses";
  const applyLink = "https://uni.nimt.ac.in/apply/nimt";
  // Course video URL (falls back to course page URL so the template slot
  // never goes empty — Meta rejects empty placeholders).
  const videoLink = (waLd.courses as any)?.video_url || courseLink;
  // Format Plivo dialer for human display in the missed-call template.
  // PLIVO_AI_PHONE_NUMBER is stored without the +; "+91 99999-99999" reads
  // cleanly inside WhatsApp.
  const plivoRaw = (Deno.env.get("PLIVO_AI_PHONE_NUMBER") || "").replace(/\D/g, "");
  const dialerForHumans = plivoRaw.length === 12 && plivoRaw.startsWith("91")
    ? `+91 ${plivoRaw.slice(2, 7)}-${plivoRaw.slice(7)}`
    : plivoRaw ? `+${plivoRaw}` : "our admissions office";

  // Priority-based template selection
  const isVisitAction = actions.some(a => a.startsWith("visit_created")) || visitDone || disposition === "visit_scheduled";
  const isCallbackAction = actions.includes("callback_followup_created") || disposition === "call_back";

  if (isVisitAction) {
    // Check if a visit actually exists in DB — create one if not
    const existingVisitRes = await fetch(
      `${SUPABASE_URL}/rest/v1/campus_visits?lead_id=eq.${leadId}&status=eq.scheduled&select=id,visit_date&order=created_at.desc&limit=1`,
      { headers: dbHeaders },
    );
    const existingVisits = await existingVisitRes.json().catch(() => []);
    let visitDate = existingVisits?.[0]?.visit_date || null;

    // If disposition says visit_scheduled but no visit record exists → create one now
    if (!existingVisits?.length) {
      const visitCall = toolsMade.find(tc => tc.name === "schedule_visit");
      const extractedDate = visitCall?.args?.visit_date
        || extractVisitDateFromTranscript(aiLines)
        || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const visitTime = /\bmorning|subah\b/.test(aiText) ? "morning" : /\bafternoon|dopahar\b/.test(aiText) ? "afternoon" : /\bevening|shaam\b/.test(aiText) ? "evening" : "morning";
      const timeMap: Record<string, string> = { morning: "10:00", afternoon: "14:00", evening: "16:00" };
      const visitTimestamp = `${extractedDate}T${timeMap[visitTime]}:00+05:30`;

      const ldRes2 = await fetch(`${SUPABASE_URL}/rest/v1/leads?id=eq.${leadId}&select=campus_id`, { headers: dbHeaders });
      const ldData2 = await ldRes2.json();
      const campusId2 = ldData2?.[0]?.campus_id || null;

      const visitBody2: Record<string, any> = { lead_id: leadId, visit_date: visitTimestamp, status: "scheduled" };
      if (campusId2) visitBody2.campus_id = campusId2;
      const createRes = await fetch(`${SUPABASE_URL}/rest/v1/campus_visits`, {
        method: "POST", headers: { ...dbHeaders, Prefer: "return=minimal" }, body: JSON.stringify(visitBody2),
      });
      if (createRes.ok) {
        visitDate = visitTimestamp;
        actions.push(`visit_created_from_disposition:${extractedDate}`);
        await fetch(`${SUPABASE_URL}/rest/v1/leads?id=eq.${leadId}`, {
          method: "PATCH", headers: { ...dbHeaders, Prefer: "return=minimal" },
          body: JSON.stringify({ stage: "visit_scheduled" }),
        });
        await fetch(`${SUPABASE_URL}/rest/v1/lead_notes`, {
          method: "POST", headers: { ...dbHeaders, Prefer: "return=minimal" },
          body: JSON.stringify({ lead_id: leadId, content: `🤖 Post-call reconciliation: Campus visit created for ${extractedDate} — disposition was visit_scheduled but no visit record existed.` }),
        });
        await assignLeadRoundRobin(leadId);
        fireAutomation("visit_scheduled", leadId);
      }
    }

    visitDate = visitDate || "the scheduled date";
    // Format date for WhatsApp if it's a full timestamp
    if (typeof visitDate === "string" && visitDate.includes("T")) {
      visitDate = visitDate.slice(0, 10);
    }
    actions.push("wa:visit_confirmation");
    return { templateKey: "visit_confirmation", templateParams: [waLd.name, visitDate, cm], buttonUrls: ["1820424915210710582"], phone: waLd.phone, actions };
  }

  if (isCallbackAction) {
    actions.push("wa:callback_scheduled");
    return { templateKey: "callback_scheduled", templateParams: [waLd.name, cn], phone: waLd.phone, actions };
  }

  if (disposition === "not_answered") {
    // Apologise + give the dialer to call back + course info + video.
    actions.push("wa:ai_missed_call_followup");
    return {
      templateKey: "ai_missed_call_followup",
      templateParams: [waLd.name, cn, dialerForHumans, courseLink, videoLink],
      phone: waLd.phone,
      actions,
    };
  }

  if (disposition === "not_interested" || disposition === "do_not_contact" || disposition === "wrong_number") {
    return actions.length > 0 ? { templateKey: "", templateParams: [], actions } : null;
  }

  // Default for interested / no disposition / partial conversation: send
  // course_info_v4 — body includes the actual courses.video_url
  // (youtu.be / instagram / etc) as a tappable URL plus a single "View
  // fees & apply" button to the course page admissions section.
  actions.push("wa:course_info_v4");
  return {
    templateKey: "course_info_v4",
    templateParams: [],
    phone: waLd.phone,
    actions,
  };
}

// ── End post-call reconciliation ─────────────────────────────────────

async function executeTool(
  toolName: string,
  args: Record<string, any>,
  callCtx: ActiveCall,
): Promise<Record<string, any>> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    apikey: SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
  };

  try {
    switch (toolName) {
      case "get_course_info": {
        // The cascade addendum tells the LLM to spell course names with
        // periods for pronunciation ("B.Sc. Nursing"), and the LLM
        // sometimes passes that dotted form as the tool arg too. The
        // courses table stores them without dots ("BSc Nursing"), so a
        // raw ilike never matches. Defensive normalisation:
        //   1) try the cleaned (no-dot, collapsed-space) name
        //   2) fall back to the last meaningful token (usually the field
        //      — "Nursing", "Pharmacy", "Administration") so even a
        //      garbled query gets a reasonable hit instead of a flat miss.
        const rawName = String(args.course_name || "");
        const cleaned = rawName.replace(/\./g, "").replace(/\s+/g, " ").trim();
        const lastWord = cleaned.split(/\s+/).filter(Boolean).pop() || cleaned;

        const tryFetch = async (term: string) => {
          const r = await fetch(
            `${SUPABASE_URL}/rest/v1/courses?name=ilike.*${encodeURIComponent(term)}*&select=id,name,code,duration_years,type,eligibility,entrance_exam,entrance_mandatory,departments(name,institutions(name,type,campuses(name,city,state)))`,
            { headers },
          );
          return (await r.json().catch(() => [])) as any[];
        };

        let courses: any[] = await tryFetch(cleaned);
        if (!courses?.length && lastWord && lastWord.length >= 3 && lastWord !== cleaned) {
          console.log(`[get_course_info] Fallback search "${cleaned}" → "${lastWord}"`);
          courses = await tryFetch(lastWord);
        }
        if (!courses?.length) {
          return {
            found: false,
            queried: rawName,
            normalised: cleaned,
            message: `No course found matching "${rawName}". Try the field name (e.g. Nursing, Pharmacy, MBA, BBA, BSc Nursing, BTech).`,
          };
        }

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

        return {
          found: true,
          name: course.name,
          duration: course.duration_years ? `${course.duration_years} years` : "not specified",
          eligibility: course.eligibility || "Check website for eligibility",
          entrance_exam: course.entrance_exam || (course.entrance_mandatory ? "Entrance exam required" : "No entrance exam. Merit and interview based."),
          fees: feeSummary,
          campus: campus ? `${campus.name}${campus.city ? `, ${campus.city}` : ""}` : "NIMT campus",
          affiliations: `VERIFIED: ${affiliations}`,
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
          // Assign counsellor via round-robin so the visit has a responsible counsellor
          await assignLeadRoundRobin(callCtx.leadId);
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

        // Guard: if disposition is visit_scheduled but schedule_visit was never called, reject
        if (args.disposition === "visit_scheduled") {
          const visitWasCalled = callCtx.toolCallsMade.some(tc => tc.name === "schedule_visit" && tc.result?.success === true);
          if (!visitWasCalled) {
            return { success: false, message: "Cannot set visit_scheduled — call schedule_visit first to book the visit, then call send_whatsapp_to_lead(visit_confirmation), then set_call_disposition." };
          }
        }

        // Guard: call_back / callback_requested REQUIRES followup_date so the
        // callback gets scheduled at the time the caller actually requested,
        // not a generic "+2h" fallback. Reject the tool call so the AI
        // re-asks the caller and tries again with the captured time.
        if (args.disposition === "call_back" || args.disposition === "callback_requested") {
          const fd = (args.followup_date || "").toString().trim();
          if (!fd) {
            return {
              success: false,
              message:
                "Cannot set call_back without followup_date. Ask the caller exactly when they want to be called back " +
                "(specific time today, tomorrow morning/afternoon/evening, or a clock time), confirm aloud, " +
                "then call set_call_disposition again with followup_date in ISO 8601 Asia/Kolkata format " +
                "(e.g. '2026-05-05T16:00:00+05:30').",
            };
          }
          // Light parse-check: reject obviously-malformed strings.
          if (isNaN(new Date(fd.includes("T") ? fd : `${fd}T10:00:00+05:30`).getTime())) {
            return {
              success: false,
              message:
                "followup_date is not a valid ISO date/datetime. Use 'YYYY-MM-DDTHH:MM:SS+05:30' " +
                "(e.g. '2026-05-05T16:00:00+05:30') or just 'YYYY-MM-DD' for date-only.",
            };
          }
        }

        // Update ai_call_records with disposition
        if (callCtx.callLogId) {
          await fetch(`${SUPABASE_URL}/rest/v1/ai_call_records?id=eq.${callCtx.callLogId}`, {
            method: "PATCH",
            headers: { ...headers, Prefer: "return=minimal" },
            body: JSON.stringify({
              disposition: args.disposition,
              summary: args.notes,
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

        // Assign counsellor via round-robin for actionable dispositions, then
        // resolve the user_id so the followup we create can be owned by them
        // (and therefore picked up by the counsellor-reminders cron).
        const needsAssignment = ["interested", "callback_requested", "call_back", "partial_conversation"].includes(args.disposition);
        let dispCounsellorUserId: string | null = null;
        if (needsAssignment) {
          let counsellorProfileId = await assignLeadRoundRobin(callCtx.leadId);
          if (!counsellorProfileId) {
            const r = await fetch(`${SUPABASE_URL}/rest/v1/leads?id=eq.${callCtx.leadId}&select=counsellor_id`, { headers });
            counsellorProfileId = (await r.json().catch(() => []))?.[0]?.counsellor_id || null;
          }
          if (counsellorProfileId) {
            const pr = await fetch(`${SUPABASE_URL}/rest/v1/profiles?id=eq.${counsellorProfileId}&select=user_id`, { headers });
            dispCounsellorUserId = (await pr.json().catch(() => []))?.[0]?.user_id || null;
          }
        }

        // Always schedule a counsellor follow-up for actionable dispositions
        const needsFollowup = args.schedule_followup ||
          ["interested", "callback_requested", "call_back", "partial_conversation"].includes(args.disposition);

        if (needsFollowup && callCtx.leadId) {
          let followupDate: string;
          if (args.followup_date) {
            followupDate = args.followup_date.includes("T") ? args.followup_date : `${args.followup_date}T10:00:00+05:30`;
          } else {
            // Interested/callback → 2 hours, partial → tomorrow
            const delayMs = ["interested", "callback_requested", "call_back"].includes(args.disposition)
              ? 2 * 60 * 60 * 1000  // 2 hours
              : 24 * 60 * 60 * 1000; // 24 hours
            followupDate = new Date(Date.now() + delayMs).toISOString();
          }

          // Distinguish callback type:
          //   - call_back / callback_requested → "ai_callback" — caller was busy
          //     and asked Navya to call them back; the ai-call-batch will retry
          //     at scheduled_at, or a counsellor can pick it up.
          //   - everything else (interested / partial_conversation) → "call" —
          //     a generic counsellor follow-up.
          const isAiCallback = args.disposition === "call_back" || args.disposition === "callback_requested";
          await fetch(`${SUPABASE_URL}/rest/v1/lead_followups`, {
            method: "POST",
            headers: { ...headers, Prefer: "return=minimal" },
            body: JSON.stringify({
              lead_id: callCtx.leadId,
              user_id: dispCounsellorUserId,
              scheduled_at: followupDate,
              type: isAiCallback ? "ai_callback" : "call",
              notes: `🤖 AI call outcome: ${args.disposition.replace(/_/g, " ")}. ${args.notes || "Counsellor follow-up required."}`,
              status: "pending",
            }),
          });
          console.log(`[Followup] Scheduled for ${callCtx.leadId}: ${args.disposition} → ${followupDate} (user=${dispCounsellorUserId || "unassigned"})`);
        }

        // Mark do_not_contact
        if (args.disposition === "do_not_contact") {
          await fetch(`${SUPABASE_URL}/rest/v1/leads?id=eq.${callCtx.leadId}`, {
            method: "PATCH",
            headers: { ...headers, Prefer: "return=minimal" },
            body: JSON.stringify({ do_not_contact: true }),
          });
        }

        console.log(`[Disposition] ${callCtx.leadId}: ${args.disposition} — ${args.notes}`);
        return { success: true, disposition: args.disposition };
      }

      case "send_whatsapp_to_lead": {
        if (!callCtx.leadId) return { success: false, message: "No lead ID" };

        // Get lead phone, course info AND course video_url for the post-summary template.
        const waLeadRes = await fetch(
          `${SUPABASE_URL}/rest/v1/leads?id=eq.${callCtx.leadId}&select=phone,name,course_id,courses:course_id(name,slug,video_url),campuses:campus_id(name)`,
          { headers },
        );
        const waLead = (await waLeadRes.json())?.[0];
        if (!waLead?.phone) return { success: false, message: "Lead has no phone" };

        const waCourse = args.course_name || (waLead.courses as any)?.name || "our programmes";
        const waSlug = (waLead.courses as any)?.slug || "";
        const waCampus = args.campus_name || (waLead.campuses as any)?.name || "NIMT campus";
        const courseUrl = waSlug ? `https://www.nimt.ac.in/courses/${waSlug}` : "https://www.nimt.ac.in/courses";
        const applyUrl = "https://uni.nimt.ac.in/apply/nimt";
        // Course-specific video URL when present, else fall back to course page
        // (so the WA template's video slot always has a real URL — Meta rejects
        // empty params).
        const videoUrl = (waLead.courses as any)?.video_url || courseUrl;

        let waTemplateKey = "";
        let waParams: string[] = [];
        let waButtonUrls: string[] | undefined;

        switch (args.message_type) {
          case "course_info":
          case "apply_link":
            // Post-call summary — opens with "as discussed on our call".
            waTemplateKey = "ai_call_post_summary";
            waParams = [waLead.name, waCourse, waCampus, courseUrl, applyUrl, videoUrl];
            break;
          case "visit_confirmation":
            waTemplateKey = "visit_confirmation";
            waParams = [waLead.name, args.visit_date || "the scheduled date", waCampus];
            waButtonUrls = ["1820424915210710582"];
            break;
          case "callback_scheduled":
            waTemplateKey = "callback_scheduled";
            waParams = [waLead.name, waCourse];
            break;
        }

        if (waTemplateKey) {
          try {
            await fetch(`${SUPABASE_URL}/functions/v1/whatsapp-send`, {
              method: "POST",
              headers: { "Content-Type": "application/json", Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
              body: JSON.stringify({ template_key: waTemplateKey, phone: waLead.phone, params: waParams, lead_id: callCtx.leadId, ...(waButtonUrls ? { button_urls: waButtonUrls } : {}) }),
            });
            console.log(`[WhatsApp] Sent ${waTemplateKey} to ${waLead.phone}`);
            return { success: true, type: args.message_type };
          } catch (e: any) {
            console.error(`[WhatsApp] Failed:`, e.message);
            return { success: false, message: e.message };
          }
        }
        return { success: false, message: "Unknown message type" };
      }

      case "update_lead_info": {
        if (!callCtx.leadId) return { success: false, message: "No lead ID" };
        const updates: Record<string, any> = {};

        // Update name if provided
        if (args.name) {
          updates.name = args.name;
          callCtx.leadName = args.name;
        }

        // Look up course by name if provided
        if (args.course_name) {
          const courseRes = await fetch(
            `${SUPABASE_URL}/rest/v1/courses?name=ilike.*${encodeURIComponent(args.course_name)}*&select=id,name&limit=1`,
            { headers },
          );
          const courses = await courseRes.json();
          if (courses?.[0]?.id) {
            updates.course_id = courses[0].id;
            console.log(`[update_lead_info] Course updated to: ${courses[0].name} (${courses[0].id})`);
          }
        }

        // Look up campus by name if provided
        if (args.campus_preference) {
          const campusRes = await fetch(
            `${SUPABASE_URL}/rest/v1/campuses?name=ilike.*${encodeURIComponent(args.campus_preference)}*&select=id,name&limit=1`,
            { headers },
          );
          const campuses = await campusRes.json();
          if (campuses?.[0]?.id) {
            updates.campus_id = campuses[0].id;
          }
        }

        if (args.email) updates.email = args.email;
        if (args.guardian_name) updates.guardian_name = args.guardian_name;

        if (Object.keys(updates).length > 0) {
          await fetch(`${SUPABASE_URL}/rest/v1/leads?id=eq.${callCtx.leadId}`, {
            method: "PATCH",
            headers: { ...headers, Prefer: "return=minimal" },
            body: JSON.stringify(updates),
          });
        }

        // Add note about the update
        if (args.notes || args.course_name) {
          await fetch(`${SUPABASE_URL}/rest/v1/lead_notes`, {
            method: "POST",
            headers: { ...headers, Prefer: "return=minimal" },
            body: JSON.stringify({
              lead_id: callCtx.leadId,
              content: `🤖 AI Call updated lead info: ${args.course_name ? `Course → ${args.course_name}` : ""} ${args.campus_preference ? `Campus → ${args.campus_preference}` : ""} ${args.notes || ""}`.trim(),
            }),
          });
        }

        return { success: true, updated_fields: Object.keys(updates) };
      }

      case "transfer_to_human_agent": {
        // Live hot-transfer using Plivo's "redirect-call-to-new-XML" API.
        // Resolve the right counsellor (existing assignment, else round-
        // robin), get their phone, then POST to Plivo's Call Update
        // endpoint pointing at /transfer-bridge/{callId} which returns
        // <Dial><Number>{counsellor_phone}</Number></Dial>. Plivo bridges
        // the legs and the AI agent leaves the call.
        //
        // If no counsellor is reachable, or it's outside business hours,
        // we fall through to a scheduled request_human_callback so the
        // caller never gets dropped.

        // Business hours gate. Rule (matches existing inbound routing at
        // server.ts:2076): 9 AM-8 PM IST, Mon-Sat. Outside this window
        // counsellors aren't reliably available even if assigned, so
        // skip the live bridge attempt and book a callback for next
        // business window. The LLM gets a clear rejection with a
        // fallback hint.
        const istNowStr = new Date().toLocaleString("en-US", {
          timeZone: "Asia/Kolkata",
          hour: "2-digit", hour12: false, weekday: "short",
        });
        const istHourBh = parseInt(istNowStr.match(/\d+/)?.[0] || "0", 10);
        const istDayBh = istNowStr.match(/(Sun|Mon|Tue|Wed|Thu|Fri|Sat)/)?.[1] || "Mon";
        const inBusinessHours = (istHourBh >= 9 && istHourBh < 20) && istDayBh !== "Sun";
        if (!inBusinessHours) {
          console.log(`[${callCtx.leadId}] transfer_to_human_agent rejected — outside business hours (${istHourBh}h ${istDayBh})`);
          return {
            success: false,
            fallback: "request_human_callback",
            message: `It's outside our business hours (9 AM-8 PM IST, Mon-Sat). Please use request_human_callback to schedule a counsellor callback at the next business window.`,
          };
        }

        const PLIVO_AUTH_ID = Deno.env.get("PLIVO_AUTH_ID");
        const PLIVO_AUTH_TOKEN = Deno.env.get("PLIVO_AUTH_TOKEN");
        if (!PLIVO_AUTH_ID || !PLIVO_AUTH_TOKEN) {
          return { success: false, message: "Plivo not configured — falling back to scheduled callback." };
        }
        if (!callCtx.leadId) return { success: false, message: "No lead ID for this call" };
        if (!callCtx.plivoCallUuid) return { success: false, message: "No active Plivo call UUID — cannot redirect." };

        // Resolve counsellor (assigned, or round-robin pick) and their phone
        let counsellorProfileId: string | null = null;
        const ldRow = await fetch(
          `${SUPABASE_URL}/rest/v1/leads?id=eq.${callCtx.leadId}&select=counsellor_id,name`,
          { headers },
        ).then(r => r.json()).catch(() => []);
        const lead = ldRow?.[0];
        counsellorProfileId = lead?.counsellor_id || null;
        if (!counsellorProfileId) {
          counsellorProfileId = await assignLeadRoundRobin(callCtx.leadId);
        }
        if (!counsellorProfileId) {
          console.warn(`[${callCtx.leadId}] transfer_to_human_agent: no counsellor available, falling back to callback`);
          // Fall through to the scheduled-callback path below by simulating
          // the request_human_callback args + reusing its handler. Cleanest
          // to just inline a minimal version here.
          return { success: false, fallback: "request_human_callback", message: "No counsellor available for live transfer — please use request_human_callback instead." };
        }

        const profRow = await fetch(
          `${SUPABASE_URL}/rest/v1/profiles?id=eq.${counsellorProfileId}&select=user_id,phone,display_name`,
          { headers },
        ).then(r => r.json()).catch(() => []);
        const counsellor = profRow?.[0];
        if (!counsellor?.phone) {
          return { success: false, fallback: "request_human_callback", message: "Counsellor has no phone on profile — please use request_human_callback." };
        }

        // Normalise the counsellor phone: strip non-digits, ensure 91 prefix
        let counsellorPhone = String(counsellor.phone).replace(/[^0-9+]/g, "");
        if (counsellorPhone.startsWith("+")) counsellorPhone = counsellorPhone.slice(1);
        if (counsellorPhone.length === 10) counsellorPhone = `91${counsellorPhone}`;

        // Stash the bridge target on the call context so the
        // /transfer-bridge/{callId} XML handler can read it back.
        (callCtx as any).bridgeTo = {
          phone: counsellorPhone,
          name: counsellor.display_name || "counsellor",
          reason: args.reason || "live transfer requested by caller",
        };

        // Build the redirect URL Plivo will hit on the live call
        const VOICE_AGENT_URL = Deno.env.get("VOICE_AGENT_URL") || "";
        const bridgeUrl = `${VOICE_AGENT_URL}/transfer-bridge/${callCtx.callLogId || callCtx.plivoCallUuid}`;

        // Plivo Call Update API: POST /Account/{auth_id}/Call/{call_uuid}/
        // Body: { url, method } — Plivo fetches this URL and replaces the
        // current call's XML with whatever it returns.
        const auth = btoa(`${PLIVO_AUTH_ID}:${PLIVO_AUTH_TOKEN}`);
        const plivoRes = await fetch(
          `https://api.plivo.com/v1/Account/${PLIVO_AUTH_ID}/Call/${callCtx.plivoCallUuid}/`,
          {
            method: "POST",
            headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
            body: JSON.stringify({ url: bridgeUrl, method: "GET" }),
          },
        );
        if (!plivoRes.ok) {
          const errBody = await plivoRes.text().catch(() => "");
          console.error(`[transfer_to_human] Plivo redirect failed ${plivoRes.status}: ${errBody.slice(0, 200)}`);
          return { success: false, fallback: "request_human_callback", message: `Live transfer failed (${plivoRes.status}). Please use request_human_callback instead.` };
        }

        // Audit trail in lead_activities
        await fetch(`${SUPABASE_URL}/rest/v1/lead_activities`, {
          method: "POST",
          headers: { ...headers, Prefer: "return=minimal" },
          body: JSON.stringify({
            lead_id: callCtx.leadId,
            type: "system",
            description: `🤖 Live transfer to counsellor ${counsellor.display_name || ""}: ${args.reason || ""}`,
          }),
        }).catch(() => {});

        // Bell notification for the counsellor so they know who they're getting
        if (counsellor.user_id) {
          fetch(`${SUPABASE_URL}/rest/v1/notifications`, {
            method: "POST",
            headers: { ...headers, Prefer: "return=minimal" },
            body: JSON.stringify({
              user_id: counsellor.user_id,
              type: "callback_requested",
              title: `Live transfer incoming: ${lead?.name || "lead"}`,
              body: args.reason || "AI agent transferring an active caller to you now.",
              link: `/admissions/${callCtx.leadId}`,
              lead_id: callCtx.leadId,
            }),
          }).catch(() => {});

          // ai_call_records row so LiveCallBar shows the incoming transfer
          // with the prominent "LIVE TRANSFER" treatment + reason. Without
          // this, only the small bell-icon notification appears and the
          // counsellor walks into the call cold.
          fetch(`${SUPABASE_URL}/rest/v1/ai_call_records`, {
            method: "POST",
            headers: { ...headers, Prefer: "return=minimal" },
            body: JSON.stringify({
              call_uuid: `${callCtx.plivoCallUuid}-bridge`, // distinct from caller leg
              lead_id: callCtx.leadId,
              caller_user_id: counsellor.user_id,
              call_type: "inbound", // LiveCallBar filter
              status: "initiated",
              is_live_transfer: true,
              transfer_reason: args.reason || "Live transfer from AI agent",
            }),
          }).catch((err) => console.error(`[transfer_to_human] live-transfer record insert failed:`, err));
        }

        console.log(`[${callCtx.plivoCallUuid}] transfer_to_human_agent → ${counsellor.display_name} (${counsellorPhone})`);
        return {
          success: true,
          transferred_to: counsellor.display_name || "counsellor",
          message: "Caller is being connected to a human counsellor now.",
        };
      }

      case "request_human_callback": {
        if (!callCtx.leadId) return { success: false, message: "No lead ID for this call" };

        // 1) Resolve a counsellor: existing assignment, else round-robin pick.
        const ldRes = await fetch(
          `${SUPABASE_URL}/rest/v1/leads?id=eq.${callCtx.leadId}&select=id,name,phone,counsellor_id,course_id,courses:course_id(name)`,
          { headers },
        );
        const ld = (await ldRes.json().catch(() => []))?.[0];
        if (!ld) return { success: false, message: "Lead not found" };

        let counsellorProfileId: string | null = ld.counsellor_id;
        if (!counsellorProfileId) {
          counsellorProfileId = await assignLeadRoundRobin(callCtx.leadId);
        }

        // notifications.user_id and lead_followups.user_id both reference
        // auth.users(id) — i.e. profiles.user_id, NOT profiles.id.
        let counsellorUserId: string | null = null;
        if (counsellorProfileId) {
          const pRes = await fetch(
            `${SUPABASE_URL}/rest/v1/profiles?id=eq.${counsellorProfileId}&select=user_id`,
            { headers },
          );
          counsellorUserId = (await pRes.json().catch(() => []))?.[0]?.user_id || null;
        }

        // 2) Schedule the followup. Default = +2 hours unless caller hinted a time.
        let scheduledAt: string;
        if (args.preferred_time && /^\d{4}-\d{2}-\d{2}/.test(args.preferred_time)) {
          scheduledAt = args.preferred_time.includes("T")
            ? args.preferred_time
            : `${args.preferred_time}T10:00:00+05:30`;
        } else {
          scheduledAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
        }

        await fetch(`${SUPABASE_URL}/rest/v1/lead_followups`, {
          method: "POST",
          headers: { ...headers, Prefer: "return=minimal" },
          body: JSON.stringify({
            lead_id: callCtx.leadId,
            user_id: counsellorUserId, // null is OK if no counsellor available
            scheduled_at: scheduledAt,
            // "human_callback" — caller asked to speak with a senior counsellor.
            // Distinct from "ai_callback" (caller is just busy and wants Navya
            // to call them back later). Counsellor sees a clear human-callback
            // task in their queue and gets a notification.
            type: "human_callback",
            notes: `👤 Human-counsellor callback requested via AI call: ${args.reason || ""}${args.preferred_time ? ` (Preferred: ${args.preferred_time})` : ""}`.trim(),
            status: "pending",
          }),
        });

        // 3) Bell notification for the counsellor (if assigned).
        if (counsellorUserId) {
          fetch(`${SUPABASE_URL}/rest/v1/notifications`, {
            method: "POST",
            headers: { ...headers, Prefer: "return=minimal" },
            body: JSON.stringify({
              user_id: counsellorUserId,
              type: "callback_requested",
              title: `Callback requested: ${ld.name || "lead"}`,
              body: `${args.reason || "AI call requested human callback"}${args.preferred_time ? ` — preferred: ${args.preferred_time}` : ""}`,
              link: `/admissions/${callCtx.leadId}`,
              lead_id: callCtx.leadId,
            }),
          }).catch(() => {});
        }

        // 4) Server-side WA confirmation to the lead so they know we'll call back.
        if (ld.phone) {
          const courseName = (ld.courses as any)?.name || callCtx.courseName || "your enquiry";
          fetch(`${SUPABASE_URL}/functions/v1/whatsapp-send`, {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
            body: JSON.stringify({
              template_key: "callback_scheduled",
              phone: ld.phone,
              params: [ld.name || "there", courseName],
              lead_id: callCtx.leadId,
            }),
          }).catch((e) => console.error(`[request_human_callback] WA send failed:`, e?.message));
        }

        // 5) Audit note for the timeline.
        fetch(`${SUPABASE_URL}/rest/v1/lead_notes`, {
          method: "POST",
          headers: { ...headers, Prefer: "return=minimal" },
          body: JSON.stringify({
            lead_id: callCtx.leadId,
            content: `🤖 AI Call requested human callback: ${args.reason}${args.preferred_time ? ` (Preferred: ${args.preferred_time})` : ""}`,
          }),
        }).catch(() => {});

        return {
          success: true,
          assigned_counsellor: counsellorProfileId,
          scheduled_at: scheduledAt,
          whatsapp_sent: !!ld.phone,
        };
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

    // Send BidiGenerateContent setup as first message.
    // model + voice come from admin settings; falling back to env GEMINI_MODEL
    // if the cache hasn't populated yet on cold start.
    const liveSettings = getVoiceSettings();
    const liveModel = liveSettings.geminiModel || GEMINI_MODEL;
    const setup = {
      setup: {
        model: `models/${liveModel}`,
        generationConfig: {
          responseModalities: ["AUDIO"],
          // ⚠️  speechConfig field landmines for the native-audio model:
          //   - languageCode → WS 1007 "Unsupported language code 'en-IN' for model
          //     models/gemini-2.5-flash-native-audio-latest". Native-audio models
          //     auto-detect language from user speech; languageCode is for the
          //     half-cascade live-preview models only. Confirmed via Cloud Run
          //     logs 2026-05-04. DO NOT add it back.
          //   - startOfSpeechSensitivity / endOfSpeechSensitivity → also WS 1007
          //     when placed inside automaticActivityDetection (valid keys there
          //     are only disabled / prefixPaddingMs / silenceDurationMs).
          speechConfig: {
            voiceConfig: {
              prebuiltVoiceConfig: {
                // Admin-controlled voice. 7 options: Aoede / Charon /
                // Fenrir / Kore / Leda / Puck / Zephyr — each with very
                // different timbre. Default Aoede (measured female).
                voiceName: liveSettings.geminiVoice,
              },
            },
          },
        },
        realtimeInputConfig: {
          automaticActivityDetection: {
            prefixPaddingMs: liveSettings.geminiPrefixPaddingMs,
            // Read from admin-controlled settings (default 1500ms).
            // Lower = snappier replies, higher = safer (no self-interrupt
            // on Hindi pauses). Tunable from /admin → AI Voice Agent card.
            silenceDurationMs: getVoiceSettings().geminiSilenceMs,
          },
        },
        // Surface STT for both sides into serverContent so we can log what
        // the caller said and what Gemini said — invaluable for debugging
        // why a tool call did/didn't fire. Native-audio model has no separate
        // text channel otherwise.
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        systemInstruction: {
          parts: [{ text: buildSystemInstruction(callCtx) }],
        },
        tools: [{
          functionDeclarations: VOICE_AGENT_TOOLS,
        }],
      },
    };
    console.log(`[${callId}] Sending Gemini setup for model: models/${liveModel}`);
    geminiWs.send(JSON.stringify(setup));
  };

  // Helper: send mulaw audio to Plivo
  const sendAudioToPlivo = (pcm24kBase64: string) => {
    if (plivoWs.readyState !== WebSocket.OPEN) return;
    const mulawAudio = geminiPcmToMulaw(pcm24kBase64);
    if (!callCtx.firstAudioSentAtMs) callCtx.firstAudioSentAtMs = Date.now();
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
      const dataType = data instanceof Blob ? `Blob(${data.size})` : data instanceof ArrayBuffer ? `ArrayBuffer(${(data as ArrayBuffer).byteLength})` : `string(${String(data).length})`;
      console.log(`[${callId}] Gemini msg received: type=${dataType}`);

      // Convert Blob/ArrayBuffer to string first — Gemini may deliver JSON as Blob
      if (data instanceof Blob) {
        const text = await data.text();
        // Try to parse as JSON first (setupComplete, serverContent, toolCall etc.)
        try {
          data = JSON.parse(text);
          console.log(`[${callId}] Gemini Blob parsed as JSON, keys: ${Object.keys(data as object).join(",")}`);
        } catch {
          // Not JSON — treat as raw binary audio (PCM 24kHz)
          const origBuf = await (event.data as Blob).arrayBuffer();
          const bytes = new Uint8Array(origBuf);
          console.log(`[${callId}] Gemini binary audio blob: ${bytes.length} bytes → sending to Plivo`);
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
          console.log(`[${callId}] Gemini ArrayBuffer parsed as JSON, keys: ${Object.keys(data as object).join(",")}`);
        } catch {
          console.log(`[${callId}] Gemini binary audio ArrayBuffer: ${bytes.length} bytes → sending to Plivo`);
          let binary = "";
          for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
          sendAudioToPlivo(btoa(binary));
          return;
        }
      } else if (typeof data === "string") {
        data = JSON.parse(data);
        console.log(`[${callId}] Gemini string JSON, keys: ${Object.keys(data as object).join(",")}`);
      }

      // data is now a parsed JSON object
      const msg = data as any;

      // Setup complete acknowledgement
      if (msg.setupComplete) {
        console.log(`[${callId}] Gemini setup complete — ready for audio`);
        configAcked = true;
        geminiReady = true;
        console.log(`[${callId}] Gemini ready — caller audio now flowing`);

        // Kick off the model's first turn explicitly.
        //
        // Without this, the native-audio model sits silent waiting for VAD
        // to detect "user speech end" — but on a freshly-connected Plivo
        // RTP carrier line there's constant low-level noise, so VAD thinks
        // the caller is mid-utterance forever. Result: the model keeps
        // sending {interrupted:true} + {turnComplete:true} with no content.
        //
        // The fix is a single clientContent text turn that nudges the
        // model to produce its first response (the greeting from the
        // system instruction). After this kickoff, normal VAD takes over.
        try {
          const kickoff = {
            clientContent: {
              turns: [{ role: "user", parts: [{ text: callCtx.direction === "inbound" ? "(call connected)" : "(starting outbound call)" }] }],
              turnComplete: true,
            },
          };
          geminiWs.send(JSON.stringify(kickoff));
          console.log(`[${callId}] Sent kickoff clientContent to trigger greeting`);
        } catch (e: any) {
          console.error(`[${callId}] Failed to send kickoff:`, e?.message || e);
        }
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

      // Transcriptions for logging + accumulation + language detection
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

          // Auto-hangup after terminal dispositions (voicemail, not_answered, etc.)
          // Wait 8 seconds for Gemini to finish speaking, then close connections
          const terminalDispositions = new Set(["voicemail", "not_interested", "wrong_number", "do_not_contact", "not_answered"]);
          const dispositionCall = responses.find((r: any) => r.name === "set_call_disposition");
          if (dispositionCall) {
            const disposition = msg.toolCall.functionCalls.find((fc: any) => fc.name === "set_call_disposition")?.args?.disposition;
            if (disposition && terminalDispositions.has(disposition)) {
              const delay = disposition === "voicemail" ? 3000 : 5000; // voicemail needs less time (short message)
              console.log(`[${callId}] Terminal disposition "${disposition}" — auto-hangup in ${delay / 1000}s`);
              setTimeout(() => {
                console.log(`[${callId}] Auto-hangup: closing Gemini and Plivo connections`);
                if (geminiWs.readyState === WebSocket.OPEN) geminiWs.close(1000, "call_ended");
                if (plivoWs.readyState === WebSocket.OPEN) plivoWs.close();
              }, delay);
            }
          }
        });
      }

      // Log any unrecognized or partial JSON messages for debugging
      if (!msg.setupComplete && !msg.toolCall) {
        if (msg.serverContent && !msg.serverContent.modelTurn?.parts?.length) {
          console.log(`[${callId}] Gemini serverContent (no parts):`, JSON.stringify(msg.serverContent).substring(0, 300));
        } else if (!msg.serverContent) {
          console.log(`[${callId}] Gemini other msg:`, JSON.stringify(msg).substring(0, 500));
        }
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
    // If Gemini crashes mid-call (1011 internal error), close the Plivo connection
    // so the caller hears a hangup rather than indefinite silence.
    if (e.code !== 1000 && plivoWs.readyState === WebSocket.OPEN) {
      console.log(`[${callId}] Gemini crashed (${e.code}) — closing Plivo connection`);
      plivoWs.close();
    }
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
          // Quality metric: stamp call start. The Plivo "start" event arrives
          // right after the WS handshake — close enough to call-connection
          // for time-to-first-audio purposes.
          callCtx.callStartedAtMs = Date.now();
          callCtx.agentProvider = "gemini-live";
          callCtx.userTurnEndAtMsList = callCtx.userTurnEndAtMsList || [];
          callCtx.agentTurnStartAtMsList = callCtx.agentTurnStartAtMsList || [];
          break;

        case "media":
          // Forward caller audio to Gemini (convert mulaw 8k → PCM 16k)
          if (geminiReady && geminiWs.readyState === WebSocket.OPEN && msg.media?.payload) {
            const pcmBase64 = mulawToGeminiPcm(msg.media.payload);
            geminiWs.send(JSON.stringify({
              realtimeInput: {
                audio: { data: pcmBase64, mimeType: "audio/pcm;rate=16000" },
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

    // Look up the existing call log entry (created by voice-call function) — do NOT create a duplicate
    if (ctx.leadId && SUPABASE_URL && SUPABASE_SERVICE_KEY) {
      try {
        const lookupRes = await fetch(
          `${SUPABASE_URL}/rest/v1/ai_call_records?call_uuid=eq.${callId}&select=id&limit=1`,
          {
            headers: {
              "Content-Type": "application/json",
              apikey: SUPABASE_SERVICE_KEY,
              Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
            },
          },
        );
        const rows = await lookupRes.json();
        if (rows?.[0]?.id) {
          const stored = activeCallContexts.get(callId);
          if (stored) stored.callLogId = rows[0].id;
          console.log(`[${callId}] Found existing call log: ${rows[0].id}`);
        } else {
          // Fallback: create if not found (edge case — direct calls without voice-call function)
          const createRes = await fetch(`${SUPABASE_URL}/rest/v1/ai_call_records`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              apikey: SUPABASE_SERVICE_KEY,
              Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
              Prefer: "return=representation",
            },
            body: JSON.stringify({
              lead_id: ctx.leadId,
              call_uuid: callId,
              status: "initiated",
            }),
          });
          const created = await createRes.json();
          if (created?.[0]?.id) {
            const stored = activeCallContexts.get(callId);
            if (stored) stored.callLogId = created[0].id;
            console.log(`[${callId}] Call log created (fallback): ${created[0].id}`);
          }
        }
      } catch (e: any) {
        console.error(`[${callId}] Failed to find/create call log:`, e.message);
      }
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { "Content-Type": "application/json" },
    });
  }

  // ── Sticky Inbound Call System ────────────────────────────────────────────
  // When a student calls back:
  // 1. Look up the lead by phone number
  // 2. Find the assigned counsellor
  // 3. Route to counsellor's phone (ring 20s)
  // 4. If counsellor doesn't answer → fall back to AI agent
  // 5. Log inbound call in DB for timeline + missed call followup
  if (path === "/answer/inbound") {
    const body = await req.formData().catch(() => null);
    const params = body ? Object.fromEntries(body) : {} as any;
    const callerPhone = params.From || params.CallerName || "";
    const plivoCallUUID = params.CallUUID || "";
    const callId = `inbound-${crypto.randomUUID().slice(0, 8)}`;
    const host = req.headers.get("host") || url.host;
    const wsProtocol = host.includes("localhost") ? "ws" : "wss";
    // The number the lead actually dialed — use that as the callerId when
    // forwarding to the counsellor so they see which DID was called (AI
    // primary, AI backup, or the dialer number if a lead happened to ring it).
    // Falls back to the configured AI primary if Plivo didn't pass `To`.
    const PLIVO_PHONE_NUMBER = (params.To as string) ||
      Deno.env.get("PLIVO_AI_PHONE_NUMBER") || "";

    console.log(`[${callId}] Inbound call from ${callerPhone}`);

    const dbHeaders = {
      "Content-Type": "application/json",
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
    };

    let leadName = "";
    let courseName = "";
    let campusName = "";
    let leadId = "";
    let counsellorPhone = "";
    let counsellorName = "";
    let counsellorUserId = "";
    let lastOutboundCallAt: string | undefined;
    try {
      const phone = callerPhone.replace(/[^0-9]/g, "").slice(-10);
      if (phone) {
        const res = await fetch(
          `${SUPABASE_URL}/rest/v1/leads?phone=ilike.*${phone}&select=id,name,course_id,counsellor_id,courses:course_id(name),campuses:campus_id(name)&limit=1`,
          { headers: dbHeaders },
        );
        const leads = await res.json().catch(() => []);
        if (leads?.[0]) {
          leadId = leads[0].id;
          leadName = leads[0].name || "";
          courseName = (leads[0].courses as any)?.name || "";
          campusName = (leads[0].campuses as any)?.name || "";

          // Look up assigned counsellor's phone
          if (leads[0].counsellor_id) {
            const profRes = await fetch(
              `${SUPABASE_URL}/rest/v1/profiles?id=eq.${leads[0].counsellor_id}&select=phone,display_name,user_id`,
              { headers: dbHeaders },
            );
            const profiles = await profRes.json().catch(() => []);
            if (profiles?.[0]?.phone) {
              counsellorPhone = profiles[0].phone.replace(/[^0-9+]/g, "");
              if (counsellorPhone.startsWith("+")) counsellorPhone = counsellorPhone.substring(1);
              if (counsellorPhone.length === 10) counsellorPhone = `91${counsellorPhone}`;
              counsellorName = profiles[0].display_name || "Counsellor";
              counsellorUserId = profiles[0].user_id || "";
            }
          }

          // Look up most recent outbound AI call to this lead (within last 24h) so Navya
          // can open the callback by referencing it instead of a generic greeting.
          const sinceIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
          const recentRes = await fetch(
            `${SUPABASE_URL}/rest/v1/ai_call_records?lead_id=eq.${leadId}&call_type=eq.ai&created_at=gte.${sinceIso}&order=created_at.desc&limit=1&select=created_at`,
            { headers: dbHeaders },
          );
          const recent = (await recentRes.json().catch(() => []))?.[0];
          if (recent?.created_at) lastOutboundCallAt = recent.created_at;
        } else {
          // Unknown caller — create a fresh lead row so the conversation has
          // somewhere to attach followups, dispositions, and notes. Without
          // this, an inbound call from a number not in CRM produced a
          // silent ghost call that disappeared. Source = "whatsapp" is the
          // default catch-all for inbound voice (matches existing channel).
          const phoneE164 = `+91${phone}`;
          const insertRes = await fetch(`${SUPABASE_URL}/rest/v1/leads`, {
            method: "POST",
            headers: { ...dbHeaders, Prefer: "return=representation" },
            body: JSON.stringify({
              name: `Inbound caller ${phone.slice(-4)}`, // Navya updates via update_lead_info
              phone: phoneE164,
              source: "inbound_call",
              stage: "new_lead",
              notes: `Auto-created on inbound AI call ${callId}`,
            }),
          });
          if (insertRes.ok) {
            const created = await insertRes.json().catch(() => []);
            if (created?.[0]?.id) {
              leadId = created[0].id;
              leadName = created[0].name || "";
              console.log(`[${callId}] Auto-created lead ${leadId} for inbound caller ${phoneE164}`);
              // Seed an activity entry so the call shows up in the lead's timeline.
              fetch(`${SUPABASE_URL}/rest/v1/lead_activities`, {
                method: "POST",
                headers: { ...dbHeaders, Prefer: "return=minimal" },
                body: JSON.stringify({
                  lead_id: leadId,
                  type: "system",
                  description: `🤖 Auto-created from inbound AI call (${phoneE164}). Navya is qualifying.`,
                }),
              }).catch(() => {});
            }
          } else {
            const errBody = await insertRes.text().catch(() => "");
            console.error(`[${callId}] Inbound auto-lead-create failed (${insertRes.status}): ${errBody.slice(0, 200)}`);
          }
        }
      }
    } catch (e) {
      console.error(`[${callId}] Lead lookup failed:`, e);
    }

    activeCallContexts.set(callId, {
      direction: "inbound",
      leadId: leadId || undefined,
      leadName,
      courseName,
      campusName,
      calledNumber: params.To || "",
      lastOutboundCallAt,
      assignedCounsellorName: counsellorName || undefined,
      callerTranscript: [],
      aiTranscript: [],
      // plivoCallUuid is needed by transfer_to_human_agent for the live
      // redirect-call REST API. Without this set, the transfer tool
      // silently fails with "No active Plivo call UUID".
      plivoCallUuid: plivoCallUUID || undefined,
      toolCallsMade: [{ name: "inbound_meta", args: { counsellorUserId, counsellorName, counsellorPhone, plivoCallUUID }, result: null }],
    });

    // Routing pre-compute: do this BEFORE the ai_call_records insert so the
    // record reflects who is *actually* handling the call (counsellor vs AI),
    // not just the lead's assigned counsellor. The LiveCallBar uses
    // caller_user_id=null on a call_type='inbound' row as the signal to render
    // "AI Agent" instead of "Unknown"; without this fix the bar would always
    // show the lead's counsellor even when the AI is actually picking up
    // (AI DID, off-hours, no counsellor).
    const onlyDigitsEarly = (s: string) => (s || "").replace(/\D/g, "");
    const dialedToEarly  = onlyDigitsEarly(params.To as string);
    const aiPrimaryEarly = onlyDigitsEarly(Deno.env.get("PLIVO_AI_PHONE_NUMBER") || "");
    const aiBackupEarly  = onlyDigitsEarly(Deno.env.get("PLIVO_AI_BACKUP_PHONE_NUMBER") || "");
    const isAiInboundNumberEarly = !!dialedToEarly && (dialedToEarly === aiPrimaryEarly || dialedToEarly === aiBackupEarly);

    const istHourEarly = parseInt(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata", hour: "2-digit", hour12: false }).match(/\d+/)?.[0] || "0", 10);
    const istDayEarly  = new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata", weekday: "short" });
    const offHours = !((istHourEarly >= 9 && istHourEarly < 20) && istDayEarly !== "Sun");

    // Will the AI actually handle this call from the start? True when:
    //   - Lead dialed an AI-dedicated DID, OR
    //   - It's outside business hours, OR
    //   - The lead has no assigned counsellor (or no counsellor phone), OR
    //   - There's no lead at all (cold caller, not in DB)
    // When this is true, the call goes straight to the AI <Stream> below and
    // no counsellor leg is ever attempted.
    const aiHandlesFromStart =
      isAiInboundNumberEarly || offHours || !counsellorPhone || !leadId;

    // Create ai_call_records entry for real-time tracking (LiveCallBar, timeline)
    if (leadId && SUPABASE_URL) {
      await fetch(`${SUPABASE_URL}/rest/v1/ai_call_records`, {
        method: "POST", headers: { ...dbHeaders, Prefer: "return=minimal" },
        body: JSON.stringify({
          lead_id: leadId,
          call_uuid: callId,
          plivo_call_uuid: plivoCallUUID,
          status: "initiated",
          call_type: "inbound",
          // null = AI is handling. counsellor_user_id = counsellor's phone is ringing.
          caller_user_id: aiHandlesFromStart ? null : counsellorUserId,
          summary: `Inbound call from ${leadName || callerPhone}${
            aiHandlesFromStart
              ? ` → AI agent${offHours ? " (off-hours, flagged for follow-up)" : isAiInboundNumberEarly ? " (AI DID)" : ""}`
              : ` → routing to ${counsellorName}`
          }`,
          needs_followup: offHours,
          followup_reason: offHours ? `Inbound at ${istHourEarly}:00 IST ${istDayEarly} — outside business hours (9 AM-8 PM IST, Mon-Sat)` : null,
        }),
      }).catch(e => console.error(`[${callId}] ai_call_records insert failed:`, e.message));
    }

    const recordingCallbackUrl = SUPABASE_URL ? `${SUPABASE_URL}/functions/v1/voice-call-callback` : "";
    const hangupUrl = `https://${host}/inbound-hangup/${callId}`;

    // Routing decision based on which DID the lead dialed:
    //
    //  - AI primary (PLIVO_AI_PHONE_NUMBER) or its HA backup
    //    → answer with the AI agent immediately. This is the dedicated
    //      inbound number leads call after seeing it on a marketing
    //      landing page or a previous AI outbound; they expect the AI.
    //
    //  - Dialer number (PLIVO_DIALER_PHONE_NUMBER) or any other DID
    //    → ring assigned counsellor first (20s) then fall back to AI.
    //      ONLY during business hours (9 AM-8 PM IST, Mon-Sat). Outside
    //      that window, no counsellor is on duty so every inbound goes
    //      straight to the AI agent, and the call is flagged for
    //      next-day counsellor follow-up via the missed-calls queue.
    //
    // Phone normalisation: Plivo strips the leading + from params.To
    // (so "918035374903" arrives) but our env vars store with the +
    // ("+918035374903"). Without normalising both sides to digits-only,
    // no DID ever matched and every call fell through to the counsellor
    // branch — the bug behind "AI primary number rings counsellor".
    const onlyDigits = (s: string) => (s || "").replace(/\D/g, "");
    const dialedTo  = onlyDigits(params.To as string);
    const aiPrimary = onlyDigits(Deno.env.get("PLIVO_AI_PHONE_NUMBER") || "");
    const aiBackup  = onlyDigits(Deno.env.get("PLIVO_AI_BACKUP_PHONE_NUMBER") || "");
    const isAiInboundNumber = !!dialedTo && (dialedTo === aiPrimary || dialedTo === aiBackup);

    const istHour = parseInt(new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata", hour: "2-digit", hour12: false }).match(/\d+/)?.[0] || "0", 10);
    const istDay  = new Date().toLocaleString("en-US", { timeZone: "Asia/Kolkata", weekday: "short" });
    const inBusinessHours = (istHour >= 9 && istHour < 20) && istDay !== "Sun";

    if (!isAiInboundNumber && inBusinessHours && leadId && counsellorPhone) {
      const aiUrl = `https://${host}/answer/inbound-ai/${callId}`;

      console.log(`[${callId}] Inbound to dialer DID ${dialedTo} → ringing counsellor ${counsellorName} (${counsellorPhone})`);

      const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Record recordSession="true" redirect="false" maxLength="3600"${recordingCallbackUrl ? ` callbackUrl="${recordingCallbackUrl}" callbackMethod="POST"` : ""} />
  <Speak voice="Polly.Kajal">Connecting you to your counsellor. Please hold.</Speak>
  <Dial callerId="${PLIVO_PHONE_NUMBER}" action="${aiUrl}" method="POST" timeout="20" hangupOnStar="true">
    <Number>${counsellorPhone}</Number>
  </Dial>
</Response>`;

      return new Response(xml, { headers: { "Content-Type": "application/xml" } });
    }

    // AI inbound DID, OR no counsellor assigned → straight to AI agent.
    const wsUrl = `${wsProtocol}://${host}/ws/${callId}`;
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Record recordSession="true" redirect="false" maxLength="3600"${recordingCallbackUrl ? ` callbackUrl="${recordingCallbackUrl}" callbackMethod="POST"` : ""} />
  <Stream streamTimeout="600" keepCallAlive="true" bidirectional="true" contentType="audio/x-mulaw;rate=8000">${wsUrl}</Stream>
</Response>`;

    const reason = isAiInboundNumber ? "AI DID" : !inBusinessHours ? "outside business hours" : !counsellorPhone ? "no counsellor assigned" : "fallthrough";
    console.log(`[${callId}] Inbound from ${callerPhone} to ${dialedTo || "?"} (${reason}, IST hour=${istHour}, day=${istDay}) → AI agent. lead: ${leadName || "unknown"}`);
    return new Response(xml, { headers: { "Content-Type": "application/xml" } });
  }

  // ── Inbound AI fallback ──────────────────────────────────────────────────
  // When counsellor doesn't answer inbound call, Plivo hits this action URL
  // which falls through to the AI voice agent
  if (path.startsWith("/answer/inbound-ai/")) {
    const callId = path.split("/answer/inbound-ai/")[1];
    const body = await req.formData().catch(() => null);
    const params = body ? Object.fromEntries(body) : {} as any;
    const dialStatus = (params.DialStatus || "").toLowerCase();
    const host = req.headers.get("host") || url.host;
    const wsProtocol = host.includes("localhost") ? "ws" : "wss";

    const callCtx = activeCallContexts.get(callId);
    const leadId = callCtx?.leadId || "";
    const counsellorName = callCtx?.toolCallsMade?.[0]?.args?.counsellorName || "Counsellor";

    console.log(`[${callId}] Inbound-AI fallback: dialStatus=${dialStatus}, lead=${callCtx?.leadName || "unknown"}`);

    // Counsellor answered → they're talking, just hang up gracefully (call is handled)
    if (dialStatus === "completed" || dialStatus === "answer") {
      // Counsellor picked up and call completed normally — log connected call
      if (leadId && SUPABASE_URL) {
        const dbH = { "Content-Type": "application/json", apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` };
        // Update ai_call_records with connected status
        await fetch(`${SUPABASE_URL}/rest/v1/ai_call_records?call_uuid=eq.${callId}`, {
          method: "PATCH", headers: { ...dbH, Prefer: "return=minimal" },
          body: JSON.stringify({
            status: "completed",
            student_connected_at: new Date().toISOString(),
            completed_at: new Date().toISOString(),
            summary: `Inbound call answered by ${counsellorName}`,
          }),
        }).catch(() => {});

        // Log in call_logs + activity
        await fetch(`${SUPABASE_URL}/rest/v1/call_logs`, {
          method: "POST", headers: { ...dbH, Prefer: "return=minimal" },
          body: JSON.stringify({
            lead_id: leadId, direction: "inbound", disposition: "answered",
            notes: `Inbound call from ${callCtx?.leadName || "student"} — answered by ${counsellorName}`,
            user_id: callCtx?.toolCallsMade?.[0]?.args?.counsellorUserId || null,
            called_at: new Date().toISOString(),
          }),
        }).catch(() => {});
        await fetch(`${SUPABASE_URL}/rest/v1/lead_activities`, {
          method: "POST", headers: { ...dbH, Prefer: "return=minimal" },
          body: JSON.stringify({
            lead_id: leadId, type: "call",
            description: `Inbound call from student — answered by ${counsellorName}`,
          }),
        }).catch(() => {});

        // Mark pending followups as completed
        await fetch(`${SUPABASE_URL}/rest/v1/lead_followups?lead_id=eq.${leadId}&status=eq.pending`, {
          method: "PATCH", headers: { ...dbH, Prefer: "return=minimal" },
          body: JSON.stringify({ status: "completed", completed_at: new Date().toISOString() }),
        }).catch(() => {});
      }

      activeCallContexts.delete(callId);
      return new Response(`<?xml version="1.0" encoding="UTF-8"?><Response><Hangup/></Response>`, {
        headers: { "Content-Type": "application/xml" },
      });
    }

    // Counsellor didn't answer → log missed call + create followup, then connect to AI
    if (leadId && SUPABASE_URL) {
      const dbH = { "Content-Type": "application/json", apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` };

      // Hand the active ai_call_records row over to "AI handling" so the
      // LiveCallBar header updates from the counsellor's name to "AI Agent"
      // on the next 5-second poll. caller_user_id=null is the bar's signal.
      await fetch(`${SUPABASE_URL}/rest/v1/ai_call_records?call_uuid=eq.${callId}`, {
        method: "PATCH", headers: { ...dbH, Prefer: "return=minimal" },
        body: JSON.stringify({
          caller_user_id: null,
          summary: `Inbound call from ${callCtx?.leadName || "student"} → ${counsellorName} didn't answer, AI took over`,
        }),
      }).catch(() => {});

      // Log missed inbound call
      await fetch(`${SUPABASE_URL}/rest/v1/call_logs`, {
        method: "POST", headers: { ...dbH, Prefer: "return=minimal" },
        body: JSON.stringify({
          lead_id: leadId, direction: "inbound", disposition: "missed",
          notes: `Inbound call from ${callCtx?.leadName || "student"} — ${counsellorName} did not answer. Routed to AI.`,
          user_id: callCtx?.toolCallsMade?.[0]?.args?.counsellorUserId || null,
          called_at: new Date().toISOString(),
        }),
      }).catch(() => {});

      // Log activity in timeline
      await fetch(`${SUPABASE_URL}/rest/v1/lead_activities`, {
        method: "POST", headers: { ...dbH, Prefer: "return=minimal" },
        body: JSON.stringify({
          lead_id: leadId, type: "call",
          description: `Missed inbound call — ${callCtx?.leadName || "student"} called back, ${counsellorName} did not answer. Routed to AI.`,
        }),
      }).catch(() => {});

      // Create missed call followup (urgent — 30 min)
      const followupAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
      await fetch(`${SUPABASE_URL}/rest/v1/lead_followups`, {
        method: "POST", headers: { ...dbH, Prefer: "return=minimal" },
        body: JSON.stringify({
          lead_id: leadId,
          scheduled_at: followupAt,
          type: "call",
          notes: `Missed inbound call — student called back but ${counsellorName} did not answer. Call back urgently.`,
          status: "pending",
        }),
      }).catch(() => {});

      // Update ai_call_records
      await fetch(`${SUPABASE_URL}/rest/v1/ai_call_records?call_uuid=eq.${callId}`, {
        method: "PATCH", headers: { ...dbH, Prefer: "return=minimal" },
        body: JSON.stringify({
          summary: `Inbound call — ${counsellorName} missed, routed to AI`,
          disposition: "missed",
        }),
      }).catch(() => {});

      // Send notification to counsellor
      if (callCtx?.toolCallsMade?.[0]?.args?.counsellorUserId) {
        await fetch(`${SUPABASE_URL}/rest/v1/notifications`, {
          method: "POST", headers: { ...dbH, Prefer: "return=minimal" },
          body: JSON.stringify({
            user_id: callCtx.toolCallsMade[0].args.counsellorUserId,
            type: "missed_call",
            title: `Missed call from ${callCtx?.leadName || "student"}`,
            body: `${callCtx?.leadName || "A student"} called back but you didn't answer. Call back within 30 minutes.`,
            link: `/admissions/${leadId}`,
            lead_id: leadId,
          }),
        }).catch(() => {});
      }

      console.log(`[${callId}] Missed inbound call logged + followup created for ${counsellorName}`);
    }

    // Fall through to AI voice agent
    const wsUrl = `${wsProtocol}://${host}/ws/${callId}`;
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Speak voice="WOMAN">Your counsellor is currently unavailable. Let me connect you with our admissions assistant.</Speak>
  <Stream streamTimeout="600" keepCallAlive="true" bidirectional="true" contentType="audio/x-mulaw;rate=8000">${wsUrl}</Stream>
</Response>`;

    return new Response(xml, { headers: { "Content-Type": "application/xml" } });
  }

  // ── Inbound call hangup ─────────────────────────────────────────────────
  // Final hangup callback for inbound calls — ensures terminal state in DB
  if (path.startsWith("/inbound-hangup/")) {
    const callId = path.split("/inbound-hangup/")[1];
    const body = await req.formData().catch(() => null);
    const params = body ? Object.fromEntries(body) : {} as any;
    const totalDuration = parseInt(params.Duration || params.BillDuration || "0");

    const callCtx = activeCallContexts.get(callId);
    if (callCtx?.leadId && SUPABASE_URL) {
      const dbH = { "Content-Type": "application/json", apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` };

      // Mark call as completed if still initiated
      await fetch(`${SUPABASE_URL}/rest/v1/ai_call_records?call_uuid=eq.${callId}&status=eq.initiated`, {
        method: "PATCH", headers: { ...dbH, Prefer: "return=minimal" },
        body: JSON.stringify({
          status: "completed",
          duration_seconds: totalDuration,
          completed_at: new Date().toISOString(),
        }),
      }).catch(() => {});

      console.log(`[${callId}] Inbound hangup: dur=${totalDuration}s`);
    }

    activeCallContexts.delete(callId);
    return new Response("OK");
  }

  // Plivo Answer URL (outbound) — returns XML with bidirectional Stream
  if (path.startsWith("/answer/")) {
    const callId = path.split("/answer/")[1];
    const host = req.headers.get("host") || url.host;
    // Always use wss:// in production (Cloud Run terminates TLS at load balancer, so url.protocol is http)
    const wsProtocol = host.includes("localhost") ? "ws" : "wss";

    // Capture Plivo's real CallUUID and stash it on callCtx so the
    // transfer_to_human_agent tool can use it later. CallUUID arrives
    // via form body on POST or query string on GET — check both.
    let plivoCallUuid: string | undefined = url.searchParams.get("CallUUID") || undefined;
    if (!plivoCallUuid && req.method === "POST") {
      try {
        const body = await req.clone().formData();
        plivoCallUuid = (body.get("CallUUID") as string) || undefined;
      } catch { /* not form-encoded — ignore */ }
    }
    if (plivoCallUuid) {
      const ctx = activeCallContexts.get(callId);
      if (ctx) ctx.plivoCallUuid = plivoCallUuid;
    }

    const recordingCallbackUrl = SUPABASE_URL
      ? `${SUPABASE_URL}/functions/v1/voice-call-callback`
      : "";
    const wsUrl = `${wsProtocol}://${host}/ws/${callId}`;
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Record recordSession="true" redirect="false" maxLength="3600"${recordingCallbackUrl ? ` callbackUrl="${recordingCallbackUrl}" callbackMethod="POST"` : ""} />
  <Stream streamTimeout="600" keepCallAlive="true" bidirectional="true" contentType="audio/x-mulaw;rate=8000">${wsUrl}</Stream>
</Response>`;

    console.log(`[${callId}] Answer URL hit (plivoCallUuid=${plivoCallUuid || "?"}), returning XML`);
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
    const dbHeaders = {
      "Content-Type": "application/json",
      apikey: SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
    };

    // Find the call record — try in-memory first, then DB lookup by call_uuid
    let callLogId = callCtx?.callLogId;
    if (!callLogId && SUPABASE_URL && SUPABASE_SERVICE_KEY) {
      // Look up by our internal callId stored as call_uuid
      const lookupRes = await fetch(
        `${SUPABASE_URL}/rest/v1/ai_call_records?call_uuid=eq.${callId}&select=id&limit=1`,
        { headers: dbHeaders },
      );
      const rows = await lookupRes.json();
      if (rows?.[0]?.id) callLogId = rows[0].id;
      console.log(`[${callId}] DB lookup for callLogId: ${callLogId || "not found"}`);
    }

    // Also update any duplicate records with same call_uuid to prevent "initiated" ghosts
    if (SUPABASE_URL && SUPABASE_SERVICE_KEY) {
      const plivoStatus = (params.CallStatus || "unknown").toLowerCase();
      const plivoUuid = params.CallUUID || params.ALegUUID || "";
      await fetch(`${SUPABASE_URL}/rest/v1/ai_call_records?call_uuid=eq.${callId}&status=eq.initiated`, {
        method: "PATCH",
        headers: { ...dbHeaders, Prefer: "return=minimal" },
        body: JSON.stringify({
          status: plivoStatus || "completed",
          plivo_call_uuid: plivoUuid || null,
          duration_seconds: parseInt(params.Duration) || 0,
          completed_at: new Date().toISOString(),
        }),
      }).catch(e => console.error(`[${callId}] Bulk status update failed:`, e.message));
    }

    if (callLogId && SUPABASE_URL && SUPABASE_SERVICE_KEY) {
      try {
        // Auto-disposition for non-answered calls
        const plivoStatus = (params.CallStatus || "unknown").toLowerCase();
        const autoDispositions: Record<string, string> = {
          busy: "busy",
          "no-answer": "not_answered",
          failed: "not_answered",
          cancel: "not_answered",
          machine: "voicemail",
        };
        const autoDisposition = autoDispositions[plivoStatus] || null;

        // Build transcript combining caller + AI (safe — callCtx may be null on cold-start)
        const callerLines = callCtx?.callerTranscript || [];
        const aiLines = callCtx?.aiTranscript || [];
        const toolsMade = callCtx?.toolCallsMade || [];
        const fullTranscript = [
          ...callerLines.map(t => `Caller: ${t}`),
          ...aiLines.map(t => `AI: ${t}`),
        ].join("\n") || null;

        // Build summary from disposition notes or auto-generate
        const summary = toolsMade.length > 0
          ? `AI call: ${toolsMade.map(tc => tc.name).join(", ")}. ${autoDisposition ? `Auto: ${plivoStatus}` : ""}`
          : autoDisposition ? `Auto: ${plivoStatus} (${params.HangupCause || ""})` : "AI voice call completed";

        // Auto-computed quality metrics (Phase 2 quality dashboard).
        // Always populate when callCtx exists — null/missing fields are
        // tolerated by finalizeQualityMetrics. The dashboard view in the
        // DB averages over non-null fields.
        const qualityMetrics = callCtx ? finalizeQualityMetrics(callCtx) : null;

        const updates: Record<string, any> = {
          status: plivoStatus,
          plivo_call_uuid: params.CallUUID || params.ALegUUID || null,
          duration_seconds: parseInt(params.Duration) || 0,
          recording_url: params.RecordingUrl || null,
          transcript: fullTranscript,
          summary: summary,
          completed_at: new Date().toISOString(),
          ...(qualityMetrics ? { quality_metrics: qualityMetrics } : {}),
          ...(autoDisposition ? { disposition: autoDisposition } : {}),
        };

        await fetch(`${SUPABASE_URL}/rest/v1/ai_call_records?id=eq.${callLogId}`, {
          method: "PATCH",
          headers: {
            ...dbHeaders,
            Prefer: "return=minimal",
          },
          body: JSON.stringify(updates),
        });
        console.log(`[${callId}] Call log updated with recording + transcripts`);

        // Get lead_id + disposition from context or DB
        let leadId = callCtx?.leadId;
        let dbDisposition: string | null = null;
        let dbVisitDate: string | null = null;
        if (!leadId && callLogId) {
          const lRes = await fetch(`${SUPABASE_URL}/rest/v1/ai_call_records?id=eq.${callLogId}&select=lead_id,disposition`, { headers: dbHeaders });
          const lRows = await lRes.json();
          leadId = lRows?.[0]?.lead_id;
          dbDisposition = lRows?.[0]?.disposition || null;
          console.log(`[${callId}] From DB: leadId=${leadId || "not found"} disposition=${dbDisposition || "none"}`);
        }

        // Auto-retry unanswered/busy via AI — re-queue with 4-hour delay, 9AM–8PM IST window
        if (autoDisposition && leadId && (autoDisposition === "busy" || autoDisposition === "not_answered" || autoDisposition === "voicemail")) {
          // Cap: check how many AI calls have already been made for this lead
          const retryCountRes = await fetch(
            `${SUPABASE_URL}/rest/v1/ai_call_records?lead_id=eq.${leadId}&select=id`,
            { headers: dbHeaders },
          );
          const retryRows = await retryCountRes.json().catch(() => []);
          const attemptCount = Array.isArray(retryRows) ? retryRows.length : 0;

          if (attemptCount < 3) {
            // Compute next permitted call time: now + 4 hours, within 9AM–8PM IST
            const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;
            const candidate = new Date(Date.now() + 4 * 60 * 60 * 1000);
            const istMs = candidate.getTime() + IST_OFFSET_MS;
            const istDate = new Date(istMs);
            const totalMins = istDate.getUTCHours() * 60 + istDate.getUTCMinutes();
            let retryAt: string;
            if (totalMins >= 540 && totalMins < 1200) {
              retryAt = candidate.toISOString(); // within window
            } else {
              const y = istDate.getUTCFullYear(), mo = istDate.getUTCMonth(), d = istDate.getUTCDate();
              const dayOffset = totalMins >= 1200 ? 1 : 0;
              retryAt = new Date(Date.UTC(y, mo, d + dayOffset, 3, 30, 0)).toISOString();
            }

            await fetch(`${SUPABASE_URL}/rest/v1/ai_call_queue`, {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                apikey: SUPABASE_SERVICE_KEY,
                Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
                Prefer: "return=minimal",
              },
              body: JSON.stringify({
                lead_id: leadId,
                status: "pending",
                scheduled_at: retryAt,
              }),
            });
            await fetch(`${SUPABASE_URL}/rest/v1/lead_notes`, {
              method: "POST",
              headers: { ...dbHeaders, Prefer: "return=minimal" },
              body: JSON.stringify({
                lead_id: leadId,
                content: `🤖 AI Call: ${autoDisposition.replace("_", " ").toUpperCase()} — AI retry queued for ${new Date(retryAt).toLocaleString("en-IN", { timeZone: "Asia/Kolkata" })} (attempt ${attemptCount + 1}/3)`,
              }),
            });
          } else {
            // Max retries (3) reached — assign via round-robin then create counsellor follow-up
            const assignedId = await assignLeadRoundRobin(leadId);

            await fetch(`${SUPABASE_URL}/rest/v1/lead_followups`, {
              method: "POST",
              headers: { ...dbHeaders, Prefer: "return=minimal" },
              body: JSON.stringify({
                lead_id: leadId,
                scheduled_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
                type: "call",
                notes: `🤖 AI reached max 3 call attempts (${autoDisposition.replace("_", " ")}) — counsellor follow-up required`,
                status: "pending",
              }),
            });
            await fetch(`${SUPABASE_URL}/rest/v1/lead_notes`, {
              method: "POST",
              headers: { ...dbHeaders, Prefer: "return=minimal" },
              body: JSON.stringify({
                lead_id: leadId,
                content: `🤖 AI Call: Max retries (3) reached — lead assigned via round-robin${assignedId ? "" : " (no team members found — unassigned)"}`,
              }),
            });
          }
        }

        // Also add recording URL to lead notes
        if (params.RecordingUrl && leadId) {
          await fetch(`${SUPABASE_URL}/rest/v1/lead_notes`, {
            method: "POST",
            headers: { ...dbHeaders, Prefer: "return=minimal" },
            body: JSON.stringify({
              lead_id: leadId,
              content: `🤖 AI Call Recording (${params.Duration || 0}s): ${params.RecordingUrl}`,
            }),
          });
        }
        // Post-call reconciliation: detect unfulfilled promises + send WhatsApp
        console.log(`[${callId}] Post-call reconciliation: plivoStatus=${plivoStatus} leadId=${leadId || "null"}`);
        if (plivoStatus === "completed" && leadId) {
          try {
            const reconciliation = await reconcilePostCall(callCtx || null, leadId, dbDisposition, dbHeaders);

            if (reconciliation) {
              console.log(`[${callId}] Reconciled: actions=[${reconciliation.actions.join(",")}]`);

              // Send WhatsApp if template was determined
              if (reconciliation.templateKey && reconciliation.phone) {
                await fetch(`${SUPABASE_URL}/functions/v1/whatsapp-send`, {
                  method: "POST",
                  headers: { "Content-Type": "application/json", Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}` },
                  body: JSON.stringify({
                    template_key: reconciliation.templateKey,
                    phone: reconciliation.phone,
                    params: reconciliation.templateParams,
                    lead_id: leadId,
                    ...(reconciliation.buttonUrls ? { button_urls: reconciliation.buttonUrls } : {}),
                  }),
                });
                console.log(`[${callId}] Post-call WhatsApp: ${reconciliation.templateKey}`);
              }

              // Append reconciliation actions to call record summary
              if (reconciliation.actions.length > 0 && callLogId) {
                const recNote = ` | Reconciled: ${reconciliation.actions.join(", ")}`;
                const curSumRes = await fetch(`${SUPABASE_URL}/rest/v1/ai_call_records?id=eq.${callLogId}&select=summary`, { headers: dbHeaders });
                const curSum = (await curSumRes.json().catch(() => []))?.[0]?.summary || "";
                await fetch(`${SUPABASE_URL}/rest/v1/ai_call_records?id=eq.${callLogId}`, {
                  method: "PATCH",
                  headers: { ...dbHeaders, Prefer: "return=minimal" },
                  body: JSON.stringify({ summary: curSum + recNote }),
                });
              }
            }
          } catch (waErr: any) {
            console.error(`[${callId}] Post-call reconciliation failed:`, waErr.message);
          }
        }
      } catch (e: any) {
        console.error(`[${callId}] Failed to update call log:`, e.message);
      }
    }

    activeCallContexts.delete(callId);
    return new Response("OK");
  }

  // ── Live transfer to human agent (called by transfer_to_human_agent tool)
  // The tool stashes { phone, name, reason } on the active call context
  // and tells Plivo's Call Update API to redirect to this URL. Plivo
  // fetches it and replaces the live call's XML with whatever we return —
  // here, a <Speak>+<Dial> that bridges the caller to the counsellor's
  // phone. AI agent's WS gets dropped naturally when the call XML changes.
  if (path.startsWith("/transfer-bridge/")) {
    const key = path.split("/transfer-bridge/")[1];
    // The key is whatever the tool used — typically callLogId, falling back
    // to plivoCallUuid. Try both lookups.
    const ctx = activeCallContexts.get(key)
      || Array.from(activeCallContexts.values()).find(c => (c as any).bridgeTo && (c.callLogId === key || c.plivoCallUuid === key));
    const bridge = (ctx as any)?.bridgeTo as { phone: string; name: string; reason: string } | undefined;
    if (!bridge?.phone) {
      console.error(`[transfer-bridge] No bridge target for key=${key}`);
      // Hang up gracefully rather than leaving the caller in limbo
      return new Response(
        `<?xml version="1.0" encoding="UTF-8"?><Response><Speak voice="Polly.Kajal" language="en-IN">We're unable to connect you to a counsellor right now. Please try again shortly.</Speak><Hangup/></Response>`,
        { headers: { "Content-Type": "application/xml" } },
      );
    }
    console.log(`[transfer-bridge ${key}] Dialing ${bridge.name} at ${bridge.phone}`);
    const callerId = Deno.env.get("PLIVO_DIALER_PHONE_NUMBER")
      || Deno.env.get("PLIVO_PHONE_NUMBER")
      || "";
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Speak voice="Polly.Kajal" language="en-IN">Connecting you to ${bridge.name} now. Please hold.</Speak>
  <Dial timeout="30" callerId="${callerId}">
    <Number>${bridge.phone}</Number>
  </Dial>
</Response>`;
    return new Response(xml, { headers: { "Content-Type": "application/xml" } });
  }

  // ── Manual Call: Bridge counsellor ↔ student ──────────────────────────────
  // POST /bridge-context/{callId} — store bridge call metadata
  if (path.startsWith("/bridge-context/") && req.method === "POST") {
    const callId = path.split("/bridge-context/")[1];
    const ctx = await req.json();
    activeCallContexts.set(callId, {
      direction: "outbound",
      leadId: ctx.leadId,
      leadName: ctx.leadName,
      courseName: ctx.courseName,
      campusName: ctx.campusName,
      callerTranscript: [],
      aiTranscript: [],
      // Store counsellor info for call_logs attribution
      toolCallsMade: [{ name: "bridge_meta", args: { counsellorUserId: ctx.counsellorUserId, counsellorName: ctx.counsellorName }, result: null }],
    });
    console.log(`[BRIDGE ${callId}] Context set: counsellor=${ctx.counsellorPhone} → student=${ctx.studentPhone}`);
    return new Response(JSON.stringify({ ok: true }), { headers: { "Content-Type": "application/json" } });
  }

  // GET /bridge-answer/{callId}?student={phone} — Plivo answer URL for bridge calls
  // When counsellor picks up, Plivo hits this → returns XML to dial the student
  if (path.startsWith("/bridge-answer/")) {
    const callId = path.split("/bridge-answer/")[1];
    const studentPhone = url.searchParams.get("student") || "";
    // Cloud dialer number — what the student sees as caller-id when the
    // counsellor's leg bridges them in. Kept distinct from the AI agent's
    // number so inbound returns route to the right answer flow.
    const PLIVO_PHONE_NUMBER = Deno.env.get("PLIVO_DIALER_PHONE_NUMBER") || "";
    const recordingCallbackUrl = SUPABASE_URL ? `${SUPABASE_URL}/functions/v1/voice-call-callback` : "";
    const host = req.headers.get("host") || url.host;
    const statusUrl = `https://${host}/bridge-status/${callId}`;

    console.log(`[BRIDGE ${callId}] Counsellor answered, dialing student: ${studentPhone}`);

    const bStatusUrl = `https://${host}/bridge-b-status/${callId}`;

    // Plivo fires <Dial callbackUrl="…"> on every Dial event (ringing,
    // answered, completed). This is the only reliable way to detect the
    // "answered" moment for a bridged leg in Plivo XML — Call.create's
    // callback_url only fires once at queue time, and <Number>'s own
    // statusCallbackUrl defaults to completed-only with no widening attr
    // that Plivo accepts.
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Record recordSession="true" redirect="false" maxLength="3600"${recordingCallbackUrl ? ` callbackUrl="${recordingCallbackUrl}" callbackMethod="POST"` : ""} />
  <Speak voice="Polly.Kajal">Connecting you to the student now.</Speak>
  <Dial callerId="${PLIVO_PHONE_NUMBER}" action="${statusUrl}" method="POST" callbackUrl="${bStatusUrl}" callbackMethod="POST" machineDetection="true" machineDetectionTime="5000">
    <Number>${studentPhone}</Number>
  </Dial>
</Response>`;

    return new Response(xml, { headers: { "Content-Type": "application/xml" } });
  }

  // POST /bridge-call-status/{callId} — Plivo per-state callback on the
  // PARENT call (set via callback_url on Call.create). Fires every time the
  // CallStatus changes (initiated → ringing → in-progress → completed). We
  // use the in-progress event to write ai_call_records.student_connected_at
  // so the lead-page polling can auto-flip the dialog.
  //
  // The <Number statusCallbackUrl="…" /bridge-b-status> path is unreliable
  // because Plivo's per-leg callback defaults to "completed"-only and the
  // attribute we'd need to widen it (statusCallbackEvent) is Twilio-only
  // syntax that Plivo rejects with "Invalid Action XML".
  if (path.startsWith("/bridge-call-status/")) {
    const callId = path.split("/bridge-call-status/")[1];
    const body = await req.formData().catch(() => null);
    const params = body ? Object.fromEntries(body) : {} as any;
    const callStatus = String(params.CallStatus || params.Status || "").toLowerCase();
    const event = String(params.Event || "").toLowerCase();

    console.log(`[BRIDGE-CALL-STATUS ${callId}] CallStatus=${callStatus} Event=${event}`);

    const isAnswered = callStatus === "in-progress" || event === "answered";
    if (isAnswered && SUPABASE_URL) {
      const dbH = { "Content-Type": "application/json", apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` };
      await fetch(`${SUPABASE_URL}/rest/v1/ai_call_records?call_uuid=eq.${callId}`, {
        method: "PATCH",
        headers: { ...dbH, Prefer: "return=minimal" },
        body: JSON.stringify({
          student_connected_at: new Date().toISOString(),
          status: "in_progress",
        }),
      }).catch(e => console.error(`[BRIDGE-CALL-STATUS ${callId}] DB update failed:`, e.message));
      console.log(`[BRIDGE-CALL-STATUS ${callId}] Wrote student_connected_at + status=in_progress`);
    }
    return new Response("OK");
  }

  // POST /bridge-status/{callId} — Plivo Dial action callback (student leg result)
  // Only saves disposition to context. bridge-hangup creates ALL DB records.
  if (path.startsWith("/bridge-status/")) {
    const callId = path.split("/bridge-status/")[1];
    const body = await req.formData().catch(() => null);
    const params = body ? Object.fromEntries(body) : {} as any;
    const dialStatus = (params.DialStatus || params.CallStatus || "unknown").toLowerCase();
    const machineResult = (params.Machine || "").toLowerCase();
    const aLegUUID = params.ALegUUID || params.ALegRequestUUID || params.CallUUID || "";
    const bLegUUID = params.DialBLegUUID || "";

    console.log(`[BRIDGE-STATUS ${callId}] ALL PARAMS:`, JSON.stringify(params));

    const callCtx = activeCallContexts.get(callId);
    if (callCtx) {
      const autoMap: Record<string, string> = { busy: "busy", "no-answer": "not_answered", timeout: "not_answered", failed: "not_answered", cancel: "cancelled" };
      let disp = autoMap[dialStatus] || null;
      if (machineResult === "true") disp = "voicemail";
      (callCtx as any)._disp = disp;
      (callCtx as any)._dialStatus = dialStatus;
      (callCtx as any)._aLegUUID = aLegUUID;
      (callCtx as any)._bLegUUID = bLegUUID;
      (callCtx as any)._statusRan = true;
      console.log(`[BRIDGE-STATUS ${callId}] disposition=${disp || "connected"} aLeg=${aLegUUID.slice(0,12)}`);
    }
    // Plivo's <Dial action="…"> expects empty body or valid PlivoML. Returning
    // plain "OK" triggers HangupCauseCode 8012 "Invalid Action XML" in Plivo
    // logs (call audio still works, but the error noise hides real failures).
    return new Response("<Response></Response>", { headers: { "Content-Type": "application/xml" } });
  }

  // POST /bridge-b-status/{callId} — Plivo <Dial callbackUrl=…> events.
  // Fires on each Dial state change (ringing / answered / completed). The
  // payload uses Event= for the state name ("Answered", "Ringing", "Hangup")
  // plus CallStatus/DialStatus mirroring the same info. We also still
  // accept the older per-Number callback shape that uses just CallStatus.
  if (path.startsWith("/bridge-b-status/")) {
    const callId = path.split("/bridge-b-status/")[1];
    const body = await req.formData().catch(() => null);
    const params = body ? Object.fromEntries(body) : {} as any;
    const callStatus = String(params.CallStatus || params.DialStatus || "").toLowerCase();
    const event = String(params.Event || "").toLowerCase();
    const bLegUUID = String(params.DialBLegUUID || params.CallUUID || "");

    console.log(`[BRIDGE-B-STATUS ${callId}] CallStatus=${callStatus} Event=${event} bLeg=${bLegUUID} ALL:`, JSON.stringify(params));

    // Store bLegUUID in call context for bridge-hangup to use
    const callCtx = activeCallContexts.get(callId);
    if (callCtx && bLegUUID) {
      (callCtx as any)._bLegUUID = bLegUUID;
    }

    // Plivo's "answered" Dial event uses Event=DialAnswer or DialConnected
    // (lowercased here). CallStatus=in-progress arrives on the
    // DialConnected event. Accept any of the three.
    const isAnsweredEvent = callStatus === "in-progress"
      || callStatus === "answered"
      || event === "answered"
      || event === "dialanswer"
      || event === "dialconnected";
    if (isAnsweredEvent && SUPABASE_URL) {
      const dbH = { "Content-Type": "application/json", apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` };
      try {
        const patchRes = await fetch(`${SUPABASE_URL}/rest/v1/ai_call_records?call_uuid=eq.${callId}`, {
          method: "PATCH",
          headers: { ...dbH, Prefer: "return=representation" },
          body: JSON.stringify({
            student_connected_at: new Date().toISOString(),
            status: "in_progress",
          }),
        });
        const patchBody = await patchRes.text().catch(() => "");
        if (!patchRes.ok) {
          console.error(`[BRIDGE-B-STATUS ${callId}] PATCH FAILED status=${patchRes.status} body=${patchBody.slice(0, 500)}`);
        } else {
          const rows = patchBody ? (JSON.parse(patchBody) as any[]) : [];
          console.log(`[BRIDGE-B-STATUS ${callId}] PATCH ok rows=${Array.isArray(rows) ? rows.length : "?"} student_connected_at=${(rows[0] || {}).student_connected_at || "(missing)"}`);
        }
      } catch (e: any) {
        console.error(`[BRIDGE-B-STATUS ${callId}] DB update threw:`, e.message);
      }
    }

    return new Response("OK");
  }

  // POST /bridge-hangup/{callId} — Plivo A-leg hangup (FINAL callback)
  // Updates the ai_call_records row created by manual-call edge function.
  if (path.startsWith("/bridge-hangup/")) {
    const callId = path.split("/bridge-hangup/")[1];
    const body = await req.formData().catch(() => null);
    const params = body ? Object.fromEntries(body) : {} as any;
    const callStatus = (params.CallStatus || "unknown").toLowerCase();
    const totalDuration = parseInt(params.Duration || "0");
    const hangupCause = params.HangupCause || "";
    const plivoALegUUID = params.CallUUID || params.ALegUUID || "";

    console.log(`[BRIDGE-HANGUP ${callId}] ALL PARAMS:`, JSON.stringify(params));

    const callCtx = activeCallContexts.get(callId);

    // Context missing (server restart cleared in-memory map). Recover from DB so
    // call_logs and ai_call_records are still written and the client poll unblocks.
    if (!callCtx?.leadId && SUPABASE_URL) {
      console.warn(`[BRIDGE-HANGUP ${callId}] Context missing — recovering from DB`);
      const recovDbH = { "Content-Type": "application/json", apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` };
      try {
        const recRes = await fetch(
          `${SUPABASE_URL}/rest/v1/ai_call_records?call_uuid=eq.${callId}&call_type=eq.manual&select=id,lead_id,caller_user_id&limit=1`,
          { headers: recovDbH }
        );
        const recs = await recRes.json().catch(() => []);
        const rec = Array.isArray(recs) && recs.length > 0 ? recs[0] : null;
        if (rec?.lead_id) {
          const dispMap: Record<string, string> = { cancel: "cancelled", busy: "busy", "no-answer": "not_answered", failed: "not_answered" };
          const recDisp = dispMap[callStatus] || "cancelled";
          const recDur = totalDuration;
          await fetch(`${SUPABASE_URL}/rest/v1/ai_call_records?call_uuid=eq.${callId}`, {
            method: "PATCH", headers: { ...recovDbH, Prefer: "return=minimal" },
            body: JSON.stringify({ status: "failed", disposition: recDisp, duration_seconds: recDur, completed_at: new Date().toISOString(), plivo_call_uuid: plivoALegUUID || undefined }),
          }).catch(e => console.error(`[BRIDGE-HANGUP ${callId}] recovery ai_call_records:`, e));
          await fetch(`${SUPABASE_URL}/rest/v1/rpc/record_cloud_call_log`, {
            method: "POST", headers: { ...recovDbH, Prefer: "return=minimal" },
            body: JSON.stringify({ p_call_uuid: callId, p_lead_id: rec.lead_id, p_user_id: rec.caller_user_id || null, p_disposition: recDisp, p_duration: recDur, p_notes: `Cloud Call [${callId.slice(0,8)}]: ${recDisp} (recovered)`, p_source: "auto", p_recording_url: null }),
          }).catch(e => console.error(`[BRIDGE-HANGUP ${callId}] recovery call_log:`, e));
          console.log(`[BRIDGE-HANGUP ${callId}] Recovery complete: lead=${rec.lead_id} disp=${recDisp}`);
        }
      } catch (e) {
        console.error(`[BRIDGE-HANGUP ${callId}] Recovery failed:`, e);
      }
      return new Response("OK");
    }

    if (!callCtx?.leadId || !SUPABASE_URL) {
      if (callCtx) activeCallContexts.delete(callId);
      return new Response("OK");
    }

    const leadId = callCtx.leadId;
    const counsellorUserId = callCtx.toolCallsMade?.[0]?.args?.counsellorUserId || null;
    const counsellorName = callCtx.toolCallsMade?.[0]?.args?.counsellorName || "Counsellor";
    const statusRan = !!(callCtx as any)._statusRan;
    let disposition: string | null = (callCtx as any)._disp ??
      (callStatus === "cancel" ? "cancelled" : callStatus === "busy" ? "busy" : callStatus === "no-answer" ? "not_answered" : null);
    const dialStatus: string = (callCtx as any)._dialStatus ?? callStatus;
    const aLegUUID = (callCtx as any)._aLegUUID ?? plivoALegUUID;
    const bLegUUID: string = (callCtx as any)._bLegUUID ?? "";

    // Student actually connected only if bLegUUID is non-empty (Plivo sets it when B-leg answers)
    // Plivo sends DialStatus="completed" even when student never answered — bLegUUID="" catches that
    const isConnected = !disposition && bLegUUID !== "" && (dialStatus === "completed" || callStatus === "completed");

    // If no disposition and student never connected → counsellor hung up before student answered
    if (!disposition && !isConnected) {
      disposition = "cancelled";
      console.log(`[BRIDGE-HANGUP ${callId}] No bLegUUID, student never answered → cancelled`);
    }

    const isAuto = !!disposition;

    const dbH = { "Content-Type": "application/json", apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` };

    console.log(`[BRIDGE-HANGUP ${callId}] statusRan=${statusRan} disp=${disposition || "connected"} dur=${totalDuration} aLeg=${aLegUUID.slice(0,12)} bLeg=${bLegUUID ? bLegUUID.slice(0,12) : "EMPTY"}`);

    // 1. call_logs — route through record_cloud_call_log() RPC so this auto
    // path doesn't duplicate the counsellor's manual save (and vice-versa).
    // source='auto' fills technical fields (duration, recording) but never
    // overwrites a disposition/notes the counsellor has already set.
    await fetch(`${SUPABASE_URL}/rest/v1/rpc/record_cloud_call_log`, {
      method: "POST", headers: { ...dbH, Prefer: "return=minimal" },
      body: JSON.stringify({
        p_call_uuid:     callId,
        p_lead_id:       leadId,
        p_user_id:       counsellorUserId,
        p_disposition:   disposition || (isConnected ? null : callStatus),
        p_duration:      totalDuration,
        p_notes:         isAuto
          ? `Cloud Call [${callId.slice(0,8)}]: ${disposition?.replace("_"," ")} (auto)`
          : `Cloud Call [${callId.slice(0,8)}]: connected (${totalDuration}s)`,
        p_source:        "auto",
        p_recording_url: null,
      }),
    }).catch(e => console.error(`[BRIDGE-HANGUP ${callId}] call_logs rpc:`, e.message));

    // 2. ai_call_records — UPDATE the row created by manual-call edge function
    // PATCH by call_uuid. If record doesn't exist (edge case), falls through silently.
    await fetch(`${SUPABASE_URL}/rest/v1/ai_call_records?call_uuid=eq.${callId}`, {
      method: "PATCH", headers: { ...dbH, Prefer: "return=minimal" },
      body: JSON.stringify({
        plivo_call_uuid: aLegUUID,
        status: isConnected ? "completed" : (disposition === "not_answered" ? "no_answer" : disposition === "cancelled" ? "failed" : "completed"),
        duration_seconds: totalDuration, disposition,
        summary: isAuto ? `Cloud Call: ${disposition?.replace("_"," ")} (auto)` : `Cloud Call: connected (${totalDuration}s) by ${counsellorName}`,
        completed_at: new Date().toISOString(),
      }),
    }).catch(e => console.error(`[BRIDGE-HANGUP ${callId}] ai_call_records:`, e.message));

    // 3. lead_activity
    await fetch(`${SUPABASE_URL}/rest/v1/lead_activities`, {
      method: "POST", headers: { ...dbH, Prefer: "return=minimal" },
      body: JSON.stringify({ lead_id: leadId, type: "call",
        description: isAuto ? `Cloud Call by ${counsellorName} — ${disposition?.replace("_"," ").toUpperCase()} (auto)` : `Cloud Call by ${counsellorName} — connected (${totalDuration}s)`,
      }),
    }).catch(e => console.error(`[BRIDGE-HANGUP ${callId}] activity:`, e.message));

    // 4. first_contact_at
    await fetch(`${SUPABASE_URL}/rest/v1/leads?id=eq.${leadId}&first_contact_at=is.null`, {
      method: "PATCH", headers: { ...dbH, Prefer: "return=minimal" },
      body: JSON.stringify({ first_contact_at: new Date().toISOString() }),
    }).catch(() => {});

    // 5. Auto-followup for unanswered/busy/voicemail
    if (isAuto && disposition !== "cancelled") {
      const cntRes = await fetch(`${SUPABASE_URL}/rest/v1/ai_call_records?lead_id=eq.${leadId}&call_type=eq.manual&select=id`, { headers: dbH });
      const prev = await cntRes.json().catch(() => []);
      const att = Array.isArray(prev) ? prev.length : 1;
      if (att >= 4) {
        await fetch(`${SUPABASE_URL}/rest/v1/leads?id=eq.${leadId}`, { method: "PATCH", headers: { ...dbH, Prefer: "return=minimal" }, body: JSON.stringify({ stage: "not_interested" }) });
        await fetch(`${SUPABASE_URL}/rest/v1/lead_notes`, { method: "POST", headers: { ...dbH, Prefer: "return=minimal" }, body: JSON.stringify({ lead_id: leadId, content: `📞 Lead marked inactive — ${att} Cloud Call attempts, all ${disposition?.replace("_"," ")}` }) });
      } else {
        const gap = att === 1 ? 4 : att === 2 ? 24 : 72;
        const fut = new Date(Date.now() + gap * 3600000);
        const ist = new Date(fut.getTime() + 5.5 * 3600000);
        const mins = ist.getUTCHours() * 60 + ist.getUTCMinutes();
        const sched = (mins >= 540 && mins < 1200) ? fut.toISOString() : new Date(Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() + (mins >= 1200 ? 1 : 0), 3, 30, 0)).toISOString();
        await fetch(`${SUPABASE_URL}/rest/v1/lead_followups`, { method: "POST", headers: { ...dbH, Prefer: "return=minimal" }, body: JSON.stringify({ lead_id: leadId, scheduled_at: sched, type: "call", notes: `Auto: ${disposition?.replace("_"," ")} attempt ${att}. Next in ${gap}h.`, status: "pending" }) });
        await fetch(`${SUPABASE_URL}/rest/v1/lead_notes`, { method: "POST", headers: { ...dbH, Prefer: "return=minimal" }, body: JSON.stringify({ lead_id: leadId, content: `📞 ${disposition?.replace("_"," ").toUpperCase()} — followup in ${gap}h (${att}/4)` }) });
      }
    }

    activeCallContexts.delete(callId);
    return new Response("OK");
  }

  // WebSocket upgrade for Plivo audio stream — dispatches to either the
  // Gemini Live native-audio handler or the Sarvam cascaded handler based
  // on the dashboard-configurable provider toggle in _app_config.
  if (path.startsWith("/ws/")) {
    const callId = path.split("/ws/")[1];
    const upgrade = req.headers.get("upgrade")?.toLowerCase();

    if (upgrade === "websocket") {
      const { socket, response } = Deno.upgradeWebSocket(req);
      // Provider must resolve SYNCHRONOUSLY so the handler attaches
      // onmessage before Plivo sends the "start" event. Earlier we awaited
      // the _app_config lookup here and lost the start event entirely
      // (handler attached too late) — handlers only saw subsequent media
      // events and never set plivoStreamId.
      const provider = getVoiceProviderSync();
      console.log(`[${callId}] Dispatching to voice provider: ${provider}`);
      if (provider === "sarvam") handlePlivoStreamSarvam(socket, callId);
      else if (provider === "plivo") {
        // Plivo Voice AI Agents normally ingest at the answer-URL XML
        // stage (with their own Connect verb), not over our /ws handler.
        // If the answer URL didn't route to Plivo and we somehow ended
        // up here, that means the Plivo integration isn't fully wired
        // up — fall back to the working Gemini path so the call doesn't
        // die. See voice-agent/PLIVO_INTEGRATION.md for the missing
        // steps (REST agent setup, webhook URL, Connect verb XML).
        console.warn(`[${callId}] Provider=plivo but reached /ws handler — Plivo agent not wired into answer URL yet. Falling back to gemini.`);
        handlePlivoStream(socket, callId);
      }
      else handlePlivoStream(socket, callId);
      return response;
    }

    return new Response("WebSocket upgrade required", { status: 426 });
  }

  return new Response("Not found", { status: 404 });
});

// ─── Voice provider toggle (sync read, refreshed in background) ──────
//
// MUST be sync so the WS handler can dispatch before Plivo's first event
// arrives. We pre-fetch on startup and then refresh every 30s in the
// background; reads from getVoiceProviderSync() return the cached value.

// Three valid providers:
//   "gemini" — Gemini Live native-audio over our own WS handler (default)
//   "sarvam" — Cascaded STT (Sarvam Saarika) → Gemini text → TTS (Bulbul)
//   "plivo"  — Plivo Voice AI Agents (managed stack: Plivo runs STT/TTS/
//              VAD/turn-detection; we expose a webhook for tool calls).
//              Scaffolded behind a feature flag — handler logs a warning
//              and falls back to "gemini" until the integration is
//              completed (see voice-agent/PLIVO_INTEGRATION.md).
type VoiceProvider = "gemini" | "sarvam" | "plivo";
let providerCache: VoiceProvider = "gemini";
async function refreshProviderCache() {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/_app_config?key=eq.voice_agent_provider&select=value`,
      { headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } },
    );
    const rows = await res.json().catch(() => []);
    const v = rows?.[0]?.value;
    if (v === "sarvam" || v === "gemini" || v === "plivo") providerCache = v;
  } catch (e) {
    console.warn(`[provider] _app_config refresh failed:`, (e as Error).message);
  }
}
function getVoiceProviderSync(): VoiceProvider { return providerCache; }
// Warm the cache on boot, then refresh every 30s — dashboard toggle
// propagates within that window.
refreshProviderCache();
setInterval(refreshProviderCache, 30_000);

// ─── Voice-agent tunable settings (admin-controlled) ─────────────────
//
// Same pattern as providerCache: keep a SYNC-readable cache, refresh in
// the background. Set in admin panel via set_voice_agent_settings RPC,
// read here via _app_config.voice_agent_settings (JSON-encoded blob).
//
// Defaults match the migration so a missing row degrades safely.
type VoiceSettings = {
  geminiSilenceMs: number;
  sarvamFillerThresholdMs: number;
  sarvamPace: number;
  sarvamSpeaker: string;
  sarvamBulbulModel: string;
  geminiVoice: string;
  geminiModel: string;
  geminiPrefixPaddingMs: number;
  cascadeMaxTokens: number;
  cascadeTemperature: number;
  cascadeLangOverride: "auto" | "hi-IN" | "en-IN";
  cascadeTtsProvider: "sarvam" | "elevenlabs";
  elevenLabsVoiceId: string;
  /** EL voice_settings.style — 0.0 (flat) → 1.0 (highly expressive). Default 0.4
   *  for Anjura: enough warmth without sounding theatrical on long replies. */
  elevenLabsStyle: number;
  /** EL voice_settings.stability — lower = more variation. Default 0.45 keeps
   *  the voice consistent without making it monotone. */
  elevenLabsStability: number;
  /** EL voice_settings.similarity_boost — match to the cloned voice. Default
   *  0.75 is the EL recommendation for cloned voices. */
  elevenLabsSimilarity: number;
  /** EL model — eleven_v3 = expressive multilingual, eleven_turbo_v2_5 = fast.
   *  v3 is slower (~30% more latency) but handles Hinglish prosody better. */
  elevenLabsModel: "eleven_turbo_v2_5" | "eleven_v3" | "eleven_multilingual_v2";
};
const VOICE_SETTINGS_DEFAULT: VoiceSettings = {
  geminiSilenceMs: 1500,
  sarvamFillerThresholdMs: 700,
  sarvamPace: 1.0,
  sarvamSpeaker: "priya",
  sarvamBulbulModel: "bulbul:v3-beta",
  geminiVoice: "Aoede",
  geminiModel: "gemini-2.5-flash-native-audio-latest",
  geminiPrefixPaddingMs: 300,
  cascadeMaxTokens: 150,
  cascadeTemperature: 0.4,
  cascadeLangOverride: "auto",
  cascadeTtsProvider: "sarvam",
  elevenLabsVoiceId: "",
  elevenLabsStyle: 0.4,
  elevenLabsStability: 0.45,
  elevenLabsSimilarity: 0.75,
  elevenLabsModel: "eleven_turbo_v2_5",
};
let voiceSettingsCache: VoiceSettings = { ...VOICE_SETTINGS_DEFAULT };
async function refreshVoiceSettingsCache() {
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/_app_config?key=eq.voice_agent_settings&select=value`,
      { headers: { apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` } },
    );
    const rows = await res.json().catch(() => []);
    const raw = rows?.[0]?.value;
    if (!raw) return;
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    voiceSettingsCache = {
      geminiSilenceMs:           Number(parsed.gemini_silence_ms          ?? VOICE_SETTINGS_DEFAULT.geminiSilenceMs),
      sarvamFillerThresholdMs:   Number(parsed.sarvam_filler_threshold_ms ?? VOICE_SETTINGS_DEFAULT.sarvamFillerThresholdMs),
      sarvamPace:                Number(parsed.sarvam_pace                ?? VOICE_SETTINGS_DEFAULT.sarvamPace),
      sarvamSpeaker:             String(parsed.sarvam_speaker             ?? VOICE_SETTINGS_DEFAULT.sarvamSpeaker),
      sarvamBulbulModel:         String(parsed.sarvam_bulbul_model        ?? VOICE_SETTINGS_DEFAULT.sarvamBulbulModel),
      geminiVoice:               String(parsed.gemini_voice               ?? VOICE_SETTINGS_DEFAULT.geminiVoice),
      geminiModel:               String(parsed.gemini_model               ?? VOICE_SETTINGS_DEFAULT.geminiModel),
      geminiPrefixPaddingMs:     Number(parsed.gemini_prefix_padding_ms   ?? VOICE_SETTINGS_DEFAULT.geminiPrefixPaddingMs),
      cascadeMaxTokens:          Number(parsed.cascade_max_tokens         ?? VOICE_SETTINGS_DEFAULT.cascadeMaxTokens),
      cascadeTemperature:        Number(parsed.cascade_temperature        ?? VOICE_SETTINGS_DEFAULT.cascadeTemperature),
      cascadeLangOverride:       (["auto","hi-IN","en-IN"].includes(parsed.cascade_lang_override) ? parsed.cascade_lang_override : "auto") as VoiceSettings["cascadeLangOverride"],
      cascadeTtsProvider:        (parsed.cascade_tts_provider === "elevenlabs" ? "elevenlabs" : "sarvam") as VoiceSettings["cascadeTtsProvider"],
      elevenLabsVoiceId:         String(parsed.elevenlabs_voice_id ?? VOICE_SETTINGS_DEFAULT.elevenLabsVoiceId),
      elevenLabsStyle:           Number(parsed.elevenlabs_style       ?? VOICE_SETTINGS_DEFAULT.elevenLabsStyle),
      elevenLabsStability:       Number(parsed.elevenlabs_stability   ?? VOICE_SETTINGS_DEFAULT.elevenLabsStability),
      elevenLabsSimilarity:      Number(parsed.elevenlabs_similarity  ?? VOICE_SETTINGS_DEFAULT.elevenLabsSimilarity),
      elevenLabsModel:           (["eleven_turbo_v2_5","eleven_v3","eleven_multilingual_v2"].includes(parsed.elevenlabs_model)
                                    ? parsed.elevenlabs_model
                                    : VOICE_SETTINGS_DEFAULT.elevenLabsModel) as VoiceSettings["elevenLabsModel"],
    };
  } catch (e) {
    console.warn(`[voice-settings] refresh failed, using defaults:`, (e as Error).message);
  }
}
function getVoiceSettings(): VoiceSettings { return voiceSettingsCache; }
refreshVoiceSettingsCache();
setInterval(refreshVoiceSettingsCache, 30_000);

// ─── Sarvam cascaded pipeline (STT → Gemini text → TTS) ──────────────
//
// Runs whenever _app_config.voice_agent_provider = 'sarvam'. Mirrors the
// Gemini Live handler's call lifecycle (context lookup, transcript
// accumulation, tool calls, disposition close-out) but routes audio
// through Sarvam STT/TTS with a Gemini text-completion brain in between.
//
// Latency budget per turn: ~700-1200ms (STT 200-400ms, Gemini text
// 200-500ms, TTS 200-400ms). Higher than Gemini Live's ~400-600ms native
// audio, but more resilient — a single provider outage doesn't kill calls.

const SARVAM_API_KEY = Deno.env.get("SARVAM_API_KEY") || "";
const ELEVENLABS_API_KEY = Deno.env.get("ELEVENLABS_API_KEY") || "";
// Reuse the same key the Gemini Live path uses — Cloud Run env has it under
// GOOGLE_AI_API_KEY, with GEMINI_API_KEY as a fallback for any environment
// that named it that way.
const GEMINI_API_KEY_FOR_TEXT = Deno.env.get("GOOGLE_AI_API_KEY") || Deno.env.get("GEMINI_API_KEY") || "";
// Bulbul v3-beta speaker. Valid speakers for v3-beta differ from v3:
// aditya, ritu, ashutosh, priya, neha, rahul, pooja, rohan, simran, kavya.
// "priya" = warm female default. Override via env var or admin UI.
const SARVAM_TTS_SPEAKER = Deno.env.get("SARVAM_TTS_SPEAKER") || "priya";

// VAD tuning for Plivo's mulaw 8kHz stream. Each Plivo frame is 160 samples
// (20ms). 50 silence frames after at least 8 voice frames = "end of utterance"
// at ~1s of silence.
const VAD_RMS_THRESHOLD = 700;
const MIN_VOICE_FRAMES = 8;     // ~160ms of speech to count as a real utterance
const END_SILENCE_FRAMES = 50;  // ~1s of silence ends the turn

// Gemini text-API content shape — matches the REST request body precisely
// so we can append both user/model text turns AND function calls / responses
// to keep multi-turn tool conversations coherent.
interface GeminiContent {
  role: "user" | "model";
  parts: Array<
    | { text: string }
    | { functionCall: { name: string; args: Record<string, any> } }
    | { functionResponse: { name: string; response: Record<string, any> } }
  >;
}

const TERMINAL_DISPOSITIONS = new Set(["voicemail", "not_interested", "wrong_number", "do_not_contact", "not_answered"]);

// ─── Cascade filler-ack cache ────────────────────────────────────────
// The cascade (STT → text Gemini → TTS) takes 2-5 s of dead silence after
// the caller stops speaking. To mask that, we keep a small bank of short
// pre-cached acknowledgement clips. After STT completes, we start a 700 ms
// race timer; if the LLM hasn't responded by then, we play ONE filler
// (rotated to avoid sounding robotic). If the LLM finishes first, no
// filler plays at all — short replies stay snappy.
//
// Filler text design notes:
//   - Hinglish (Latin script with Hindi loanwords), NOT Devanagari. Anjura
//     pronounces Hinglish more consistently than Devanagari, which lets the
//     filler match the rest of the conversation in tone + volume. Earlier
//     all-Devanagari fillers sounded "louder/odder" because EL TTS treats
//     pure-Devanagari short clips with different prosody.
//   - Slightly longer (1.0-1.5 s spoken) so the post-filler silence while
//     the LLM finishes is shorter / less awkward.
const FILLER_TEXTS = [
  "Ji, ek second main check kar rahi hoon.",
  "Hmm, ek moment.",
  "Achha, dekhti hoon.",
];
const fillerMulawCache: (string | null)[] = FILLER_TEXTS.map(() => null);
let fillerWarming = false;
let fillerRotation = 0;
// Track the (speaker, pace, model) tuple used for the cache so we know
// when to re-render. Set when warming completes; compared on each call.
let fillerCacheSig: string | null = null;
function currentFillerSig(): string {
  const s = getVoiceSettings();
  // Include provider + voiceId + EL voice settings so the cache invalidates
  // when ANY parameter that affects render output changes. Without the EL
  // settings here, switching expressive mode in admin wouldn't re-render
  // the fillers and they'd sound mismatched against the main response.
  return [
    s.cascadeTtsProvider,
    s.elevenLabsVoiceId,
    s.elevenLabsModel,
    s.elevenLabsStyle,
    s.elevenLabsStability,
    s.elevenLabsSimilarity,
    s.sarvamSpeaker,
    s.sarvamPace,
    s.sarvamBulbulModel,
  ].join("|");
}
async function warmFillerCache(): Promise<void> {
  if (fillerWarming || !SARVAM_API_KEY) return;
  // Settings changed since last warm — wipe the cache so we re-render
  // with the new speaker/pace/model the admin selected.
  const sig = currentFillerSig();
  if (fillerCacheSig && fillerCacheSig !== sig) {
    for (let i = 0; i < fillerMulawCache.length; i++) fillerMulawCache[i] = null;
    fillerCacheSig = null;
  }
  if (fillerMulawCache.every(c => c !== null)) return;
  fillerWarming = true;
  try {
    const settings = getVoiceSettings();
    const useElevenForFiller = settings.cascadeTtsProvider === "elevenlabs"
      && !!ELEVENLABS_API_KEY
      && !!settings.elevenLabsVoiceId;
    for (let i = 0; i < FILLER_TEXTS.length; i++) {
      if (fillerMulawCache[i]) continue;
      const pcm = useElevenForFiller
        ? await elevenLabsTTS({
            apiKey: ELEVENLABS_API_KEY,
            text: FILLER_TEXTS[i],
            voiceId: settings.elevenLabsVoiceId,
            model: settings.elevenLabsModel,
            speed: settings.sarvamPace,
            style: settings.elevenLabsStyle,
            stability: settings.elevenLabsStability,
            similarityBoost: settings.elevenLabsSimilarity,
          })
        : await sarvamTTS({
            apiKey: SARVAM_API_KEY,
            text: FILLER_TEXTS[i],
            speaker: settings.sarvamSpeaker || SARVAM_TTS_SPEAKER,
            languageCode: "hi-IN",
            pace: settings.sarvamPace,
            model: settings.sarvamBulbulModel,
          });
      if (pcm) {
        fillerMulawCache[i] = pcm16ToMulawBase64(pcm);
        console.log(`[sarvam-filler] cached "${FILLER_TEXTS[i]}" (${fillerMulawCache[i]!.length}b)`);
      }
    }
    fillerCacheSig = currentFillerSig();
  } catch (e) {
    console.warn(`[sarvam-filler] warm failed:`, (e as Error).message);
  } finally {
    fillerWarming = false;
  }
}
// Pick the next filler in rotation. Returns null if cache empty.
function nextFiller(): string | null {
  const ready = fillerMulawCache.filter((c): c is string => !!c);
  if (ready.length === 0) return null;
  const pick = ready[fillerRotation % ready.length];
  fillerRotation++;
  return pick;
}
// Fire-and-forget at module init so the first call doesn't pay the cost.
warmFillerCache();

function handlePlivoStreamSarvam(plivoWs: WebSocket, callId: string) {
  const callCtx = activeCallContexts.get(callId);
  if (!callCtx) {
    console.error(`[${callId}] No call context found for Sarvam handler`);
    plivoWs.close();
    return;
  }

  const history: GeminiContent[] = [];
  let utteranceBuffer: number[] = []; // Int16 samples for current utterance
  let voiceFrames = 0;
  let silenceFrames = 0;
  let aiSpeaking = false; // gate STT while we're playing TTS back
  let plivoStreamId: string | null = null;
  let lastUserText = "";

  const sendTtsToPlivo = async (text: string) => {
    aiSpeaking = true;
    try {
      // Pick TTS phonetics from the dominant script in the response —
      // unless the admin has forced a specific language ("auto" = detect,
      // "hi-IN" = always Hindi phonemes, "en-IN" = always English).
      const settings = getVoiceSettings();
      const langCode = settings.cascadeLangOverride === "auto"
        ? detectSarvamLanguageCode(text)
        : settings.cascadeLangOverride;
      // Provider switch — admin picks "sarvam" or "elevenlabs" in
      // /admin → AI Voice Agent → Sarvam Cascade. Falls back to Sarvam
      // gracefully if ElevenLabs is selected but voice_id or API key
      // is missing (so admin can't accidentally break calls by toggling
      // before pasting a voice_id).
      // Why we may NOT use ElevenLabs even when admin selected it:
      //   1) ELEVENLABS_API_KEY missing on Cloud Run env
      //   2) elevenLabsVoiceId blank in admin UI
      // Either case logs a warning ONCE per call (gated by aiTranscript
      // length) so we know which guard tripped — silent fallback was
      // making mid-call voice changes mysterious.
      const elProviderSelected = settings.cascadeTtsProvider === "elevenlabs";
      const useElevenLabs = elProviderSelected && !!ELEVENLABS_API_KEY && !!settings.elevenLabsVoiceId;
      if (elProviderSelected && !useElevenLabs && callCtx.aiTranscript.length === 0) {
        if (!ELEVENLABS_API_KEY) console.warn(`[${callId}] EL provider selected but ELEVENLABS_API_KEY env is empty → using Sarvam Bulbul`);
        else if (!settings.elevenLabsVoiceId) console.warn(`[${callId}] EL provider selected but elevenLabsVoiceId admin setting is empty → using Sarvam Bulbul`);
      }
      let pcm: Int16Array | null = null;
      if (useElevenLabs) {
        pcm = await elevenLabsTTS({
          apiKey: ELEVENLABS_API_KEY,
          text,
          voiceId: settings.elevenLabsVoiceId,
          model: settings.elevenLabsModel,
          speed: settings.sarvamPace,
          style: settings.elevenLabsStyle,
          stability: settings.elevenLabsStability,
          similarityBoost: settings.elevenLabsSimilarity,
        });
        // Auto-fallback to Sarvam if ElevenLabs fails (network blip, rate
        // limit, voice_id rejected). The detailed reason is logged inside
        // elevenLabsTTS itself; here we just record that the cascade
        // SWITCHED VOICES mid-call so it's grep-able in Cloud Run logs.
        if (!pcm) {
          console.warn(`[${callId}] ⚠ VOICE-SWITCH mid-call: EL failed → falling back to Sarvam Bulbul (text="${text.slice(0, 80)}")`);
          callCtx.voiceSwitchCount = (callCtx.voiceSwitchCount || 0) + 1;
          pcm = await sarvamTTS({
            apiKey: SARVAM_API_KEY,
            text,
            speaker: settings.sarvamSpeaker || SARVAM_TTS_SPEAKER,
            languageCode: langCode,
            pace: settings.sarvamPace,
            model: settings.sarvamBulbulModel,
          });
        }
      } else {
        pcm = await sarvamTTS({
          apiKey: SARVAM_API_KEY,
          text,
          speaker: settings.sarvamSpeaker || SARVAM_TTS_SPEAKER,
          languageCode: langCode,
          pace: settings.sarvamPace,
          model: settings.sarvamBulbulModel,
        });
      }
      if (!pcm) {
        console.warn(`[${callId}] sarvam-tts returned empty pcm`);
        return;
      }
      if (plivoWs.readyState !== WebSocket.OPEN) return;
      if (!callCtx.firstAudioSentAtMs) callCtx.firstAudioSentAtMs = Date.now();
      callCtx.agentTurnStartAtMsList = callCtx.agentTurnStartAtMsList || [];
      callCtx.agentTurnStartAtMsList.push(Date.now());
      // Send the full mulaw payload in one playAudio event — Plivo handles
      // pacing on its side. Chunking into 20ms frames + sleep delays caused
      // the audio to never reach the caller in our earlier attempt.
      const mulawB64 = pcm16ToMulawBase64(pcm);
      plivoWs.send(JSON.stringify({
        event: "playAudio",
        media: { contentType: "audio/x-mulaw", sampleRate: 8000, payload: mulawB64 },
      }));
      console.log(`[${callId}] Sent ${pcm.length} samples (${mulawB64.length} mulaw bytes) to Plivo`);
      // Hold the speaking flag for roughly the audio duration (8kHz → 0.125ms/sample)
      // so STT doesn't try to transcribe our own TTS bleed.
      await new Promise(r => setTimeout(r, Math.min(15000, (pcm.length / 8000) * 1000 + 200)));
    } finally {
      aiSpeaking = false;
    }
  };

  // One round-trip to Gemini text-gen with the current history. Returns the
  // raw model `parts` array so the caller can decide what to do (speak text,
  // execute tools, both).
  const callGemini = async (): Promise<any[]> => {
    // Cascade-path-only addendum: Sarvam Bulbul reads text using the
    // phonetics of the script it's written in. If the model emits Hindi
    // words in Latin transliteration ("main Navya hoon"), Bulbul reads
    // each token as English ("m-a-i-n nav-yuh ho-on") and the speech
    // sounds broken with letters separating from words. Forcing Devanagari
    // for any Hindi/Hinglish output makes the script detector route to
    // hi-IN phonetics and the speech becomes naturally fluent. English-
    // only responses keep using Latin and stay routed to en-IN.
    const cascadeAddendum = `

CASCADED-PATH OUTPUT SCRIPT RULE (STRICT — affects pronunciation):
Your written response is fed verbatim to a Hindi/English TTS engine. The
engine picks pronunciation from the script you write in.
- Any Hindi or Hinglish word MUST be written in Devanagari (देवनागरी), NOT in Latin transliteration.
  ✗ Bad:  "Main Navya bol rahi hoon, NIMT se."
  ✓ Good: "मैं नव्या बोल रही हूँ, N.I.M.T. से।"
- Pure-English sentences stay in Latin script.
- Mixed sentences keep English brand names / acronyms in Latin and Hindi words in Devanagari.
  ✓ Good: "नमस्ते, आपने M.B.A. के बारे में enquiry की थी।"

ACRONYM AND COURSE-NAME FORMATTING (STRICT — fixes robotic spelling):
The TTS engine reads the literal characters you write. Use these patterns:

1. Brand acronyms (NIMT, AICTE, UGC, NCTE, BCI, INC, AKTU, GGSIPU, IIT, IIM):
   ALWAYS write with periods between letters so each letter is pronounced cleanly.
   ✗ Bad: "NIMT", "AICTE"     (often read as one mangled word)
   ✓ Good: "N.I.M.T.", "A.I.C.T.E.", "U.G.C.", "N.C.T.E."

2. Course initialisms read as letters (MBA, BBA, BCA, MCA, MBBS, BPT, MPT, GNM, PGDM):
   Write with periods so each letter pronounces.
   ✗ Bad: "MBA", "BBA", "BCA"
   ✓ Good: "M.B.A.", "B.B.A.", "B.C.A.", "M.B.B.S.", "B.P.T.", "G.N.M."

3. Mixed course names (BSc, MSc, BTech, MTech, BEd, BPharm, DPharm, LLB, LLM):
   Always write with explicit periods between every initial; spell out the suffix.
   ✗ Bad: "BSc Nursing", "BTech CSE", "BEd"
   ✓ Good: "B.Sc. Nursing", "B.Tech. C.S.E.", "B.Ed.", "B.Pharm.", "D.Pharm.", "L.L.B.", "L.L.M."

4. Numbers and rupees: write rupee amounts in words for pacing.
   ✓ Good: "fees five lakh rupees per year", "fees ₹1.2 lakh", "duration चार साल" (in Devanagari context)

This is mechanical, not stylistic — never emit Hindi tokens in Latin, never emit acronyms without periods.

TOOL ARGUMENTS — IMPORTANT EXCEPTION:
The dotted formatting (B.Sc., M.B.A., N.I.M.T.) is for SPEECH only. When you
call a tool (get_course_info, send_whatsapp_to_lead, etc.), pass the PLAIN
database-style name as the argument, with NO periods.
  ✗ Bad:  get_course_info({ course_name: "B.Sc. Nursing" })
  ✓ Good: get_course_info({ course_name: "BSc Nursing" }) or just "Nursing"
  ✗ Bad:  schedule_visit({ campus_name: "G.G.S.I.P.U." })
  ✓ Good: schedule_visit({ campus_name: "GGSIPU" })

NATURAL CADENCE (sound human, not a TTS dump):
- Open replies occasionally with a short softener: "जी,", "हम्म,", "अच्छा,", "एक सेकंड,". Use ONE per turn, max — never stack ("हम्म ठीक अच्छा").
- Mid-sentence, allow ONE small natural pause marker if the topic is heavy: "...उम्म..." or "...ek second...". Don't overdo it.
- Short replies are better than long ones. 2 sentences is the sweet spot. Never more than 3.

QUALIFICATION GATE — DO NOT FORGET:
This is the entire purpose of the call. After you have answered the caller's
factual questions and they sound satisfied (says "ok", "theek hai", "samajh
gaya", "thanks", or stops asking), you MUST proactively ask:

  "बहुत अच्छा। क्या आप course के लिए online apply करना चाहेंगे, या पहले हमारा campus visit करेंगे?"

If they say "later"/"abhi nahi"/"soch ke batata hoon" — STILL send them the
apply link via WhatsApp ("मैं आपको WhatsApp पर apply link भेज देती हूँ — uni.nimt.ac.in") and
disposition as call_back with tomorrow 11 AM IST as followup_date.

Never close the call without doing one of: schedule_visit, send_whatsapp_to_lead(apply_link),
or request_human_callback. Then call set_call_disposition. A satisfied
caller who hangs up without a next step is a FAILED qualification.`;
    const systemPrompt = buildSystemInstruction(callCtx) + cascadeAddendum;
    const cascadeSettings = getVoiceSettings();
    const body = JSON.stringify({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: history,
      tools: [{ functionDeclarations: VOICE_AGENT_TOOLS }],
      // Both knobs admin-controlled. Defaults: temp=0.4 (steady),
      // maxOutputTokens=150 (~2-3 short sentences in Devanagari).
      generationConfig: {
        temperature: cascadeSettings.cascadeTemperature,
        maxOutputTokens: cascadeSettings.cascadeMaxTokens,
      },
    });
    // Try the primary model first; if Gemini returns 503/429 (high-demand
    // overload — observed mid-call on 2026-05-06), retry once after 600ms,
    // then fail over to a sibling model with separate quota. Keeping the
    // call alive on a transient overload is more important than which
    // exact model produced the reply.
    const MODELS = ["gemini-2.5-flash", "gemini-2.0-flash"];
    const TRANSIENT = new Set([429, 500, 502, 503, 504]);
    const tryOnce = async (model: string): Promise<{ status: number; res: Response } | null> => {
      try {
        const r = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY_FOR_TEXT}`,
          { method: "POST", headers: { "Content-Type": "application/json" }, body },
        );
        return { status: r.status, res: r };
      } catch (e) {
        console.error(`[${callId}] Gemini ${model} fetch threw:`, (e as Error).message);
        return null;
      }
    };
    let attempt = 0;
    for (const model of MODELS) {
      for (let retry = 0; retry < 2; retry++) {
        attempt++;
        const result = await tryOnce(model);
        if (!result) break; // network error — try next model
        if (result.res.ok) {
          if (attempt > 1) console.log(`[${callId}] Gemini succeeded on attempt ${attempt} (${model})`);
          const data = await result.res.json();
          return data?.candidates?.[0]?.content?.parts || [];
        }
        const errBody = await result.res.text().catch(() => "");
        console.error(`[${callId}] Gemini ${model} ${result.status}: ${errBody.slice(0, 200)}`);
        if (!TRANSIENT.has(result.status)) return []; // hard error — bail out, don't retry/failover
        if (retry === 0) await new Promise(r => setTimeout(r, 600));
      }
      // Exhausted retries on this model — fall through to the next one.
    }
    return [];
  };

  // Drives the model turn loop: speak any text, execute any tool calls,
  // feed results back, repeat until the model returns no more tool calls.
  // Honours terminal-disposition auto-hangup like the Gemini Live path does.
  const runModelTurn = async () => {
    let safety = 0;
    while (safety++ < 5) {
      const parts = await callGemini();
      if (!parts.length) return;

      // Persist the model turn into history exactly as returned (text + any
      // function calls together) so the next loop iteration sees the right
      // tool-call → tool-response pairing.
      history.push({ role: "model", parts });

      // Speak any text content
      const textParts = parts.filter((p: any) => typeof p.text === "string" && p.text.trim());
      const spokenText = textParts.map((p: any) => p.text).join(" ").trim();
      if (spokenText) {
        console.log(`[${callId}] AI said (sarvam): ${spokenText}`);
        callCtx.aiTranscript.push(spokenText);
        await sendTtsToPlivo(spokenText);
      }

      // Execute any tool calls in parallel and feed results back
      const fnCalls = parts.filter((p: any) => p.functionCall).map((p: any) => p.functionCall);
      if (!fnCalls.length) return; // model done — wait for next user utterance

      console.log(`[${callId}] Tool calls (sarvam):`, fnCalls.map((fc: any) => fc.name));
      const responses = await Promise.all(fnCalls.map(async (fc: any) => {
        const result = await executeTool(fc.name, fc.args || {}, callCtx);
        callCtx.toolCallsMade.push({ name: fc.name, args: fc.args, result });
        return { name: fc.name, response: result };
      }));

      // Append tool results as a "user" turn with functionResponse parts —
      // this is how Gemini's REST API expects multi-turn tool conversations.
      history.push({
        role: "user",
        parts: responses.map(r => ({ functionResponse: { name: r.name, response: r.response } })),
      });

      // Auto-hangup on terminal disposition — mirrors the Gemini Live path.
      const dispositionCall = fnCalls.find((fc: any) => fc.name === "set_call_disposition");
      if (dispositionCall && TERMINAL_DISPOSITIONS.has(dispositionCall.args?.disposition)) {
        const delay = dispositionCall.args.disposition === "voicemail" ? 3000 : 5000;
        console.log(`[${callId}] Terminal disposition "${dispositionCall.args.disposition}" — auto-hangup in ${delay / 1000}s`);
        setTimeout(() => {
          console.log(`[${callId}] Auto-hangup: closing Plivo (sarvam)`);
          if (plivoWs.readyState === WebSocket.OPEN) plivoWs.close();
        }, delay);
        return;
      }
      // Loop: model gets to react to the tool results in the next iteration
    }
    console.warn(`[${callId}] Sarvam tool-loop hit safety cap (5 iterations)`);
  };

  const processUtterance = async () => {
    if (utteranceBuffer.length === 0) return;
    const pcm = new Int16Array(utteranceBuffer);
    utteranceBuffer = [];
    voiceFrames = 0;
    silenceFrames = 0;

    // Quality metric: VAD has detected end-of-utterance — caller stopped
    // speaking. Pair this with the next agentTurnStart to compute
    // turn latency.
    callCtx.userTurnEndAtMsList = callCtx.userTurnEndAtMsList || [];
    callCtx.userTurnEndAtMsList.push(Date.now());

    aiSpeaking = true; // gate further STT until we're done responding
    try {
      const stt = await sarvamSTT({ apiKey: SARVAM_API_KEY, pcm, languageCode: "unknown" });
      if (!stt?.transcript) return;
      const userText = stt.transcript.trim();
      if (!userText || userText === lastUserText) return;
      lastUserText = userText;

      console.log(`[${callId}] Caller said (sarvam): ${userText}`);
      callCtx.callerTranscript.push(userText);

      // Race the filler against the LLM. Threshold is admin-tunable —
      // 0 = always play, ~2000 = effectively never. If the LLM finishes
      // first, no filler plays. Filler text rotates across 3 variants so
      // it never repeats two turns in a row.
      const fillerThresholdMs = getVoiceSettings().sarvamFillerThresholdMs;
      let fillerFired = false;
      const fillerTimer = setTimeout(() => {
        if (plivoWs.readyState !== WebSocket.OPEN) return;
        const payload = nextFiller();
        if (!payload) {
          // Cache miss — warm it for next time and skip this turn's filler.
          if (!fillerWarming) warmFillerCache();
          return;
        }
        fillerFired = true;
        plivoWs.send(JSON.stringify({
          event: "playAudio",
          media: { contentType: "audio/x-mulaw", sampleRate: 8000, payload },
        }));
      }, fillerThresholdMs);

      history.push({ role: "user", parts: [{ text: userText }] });
      try {
        await runModelTurn();
      } finally {
        clearTimeout(fillerTimer);
      }
      // (debug) help diagnose if fillers are ever firing for fast replies
      if (fillerFired) console.log(`[${callId}] filler-ack played`);
    } finally {
      aiSpeaking = false;
    }
  };

  plivoWs.onopen = () => {
    console.log(`[${callId}] Plivo WS open (sarvam)`);
  };

  plivoWs.onmessage = async (event) => {
    try {
      const msg = JSON.parse(event.data as string);
      if (msg.event === "start") {
        plivoStreamId = msg.start?.streamId;
        console.log(`[${callId}] Plivo stream started (sarvam), streamId: ${plivoStreamId}`);
        // Quality metric: stamp start of cascade-path call.
        callCtx.callStartedAtMs = Date.now();
        callCtx.agentProvider = "cascade";
        callCtx.userTurnEndAtMsList = callCtx.userTurnEndAtMsList || [];
        callCtx.agentTurnStartAtMsList = callCtx.agentTurnStartAtMsList || [];
        // Greet first — kickoff trick to nudge the model into producing the
        // greeting from the system instruction without waiting for caller speech.
        history.push({ role: "user", parts: [{ text: "(call connected — greet me now)" }] });
        await runModelTurn();
        return;
      }
      if (msg.event !== "media" || !msg.media?.payload || aiSpeaking) return;

      const pcm = mulawBase64ToPcm16(msg.media.payload);
      const energy = rmsEnergy(pcm);

      if (energy >= VAD_RMS_THRESHOLD) {
        voiceFrames++;
        silenceFrames = 0;
        for (let i = 0; i < pcm.length; i++) utteranceBuffer.push(pcm[i]);
      } else {
        silenceFrames++;
        if (voiceFrames > 0) {
          // accumulate trailing silence too — STT does better with a small
          // tail than with a hard cutoff at the last voiced frame
          for (let i = 0; i < pcm.length; i++) utteranceBuffer.push(pcm[i]);
        }
        if (voiceFrames >= MIN_VOICE_FRAMES && silenceFrames >= END_SILENCE_FRAMES) {
          await processUtterance();
        }
      }
    } catch (e) {
      console.error(`[${callId}] Sarvam handler error:`, (e as Error).message);
    }
  };

  plivoWs.onclose = () => {
    console.log(`[${callId}] Plivo WS closed (sarvam) — turns: ${history.length}`);
  };
  plivoWs.onerror = (e) => {
    console.error(`[${callId}] Plivo WS error (sarvam):`, e);
  };
}

console.log(`🎙️ NIMT Voice Agent Server running on port ${PORT}`);
