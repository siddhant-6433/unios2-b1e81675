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

const PORT = parseInt(Deno.env.get("PORT") || "8000");
const GOOGLE_AI_API_KEY = Deno.env.get("GOOGLE_AI_API_KEY") || "";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_KEY") || "";
// Key for calling Supabase Edge Functions — VOICE_AGENT_KEY is a dedicated shared secret
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("VOICE_AGENT_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || SUPABASE_SERVICE_KEY;
const GEMINI_MODEL = "gemini-3.1-flash-live-preview";

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
}
const activeCallContexts = new Map<string, ActiveCall>();

/**
 * Execute a tool call from Gemini against Supabase.
 */
const MIRAI_CAMPUS_ID = "c0000002-0000-0000-0000-000000000001";

/**
 * Assigns a lead to a counsellor via round-robin within the appropriate team:
 *   Mirai campus  → "Mirai Admissions"
 *   School campus → "NSAEII Admissions"
 *   College       → "Grn Counselling"
 *
 * Skips if the lead already has a counsellor assigned.
 * Returns the assigned profile id or null.
 */
async function assignLeadRoundRobin(leadId: string): Promise<string | null> {
  const h = {
    "Content-Type": "application/json",
    apikey: SUPABASE_SERVICE_KEY,
    Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
  };

  // Fetch lead campus + institution type, and whether already assigned
  const ldRes = await fetch(
    `${SUPABASE_URL}/rest/v1/leads?id=eq.${leadId}&select=counsellor_id,campus_id,campuses:campus_id(institutions:institution_id(type))`,
    { headers: h },
  );
  const ld = (await ldRes.json().catch(() => []))?.[0];
  if (!ld) return null;
  if (ld.counsellor_id) return ld.counsellor_id; // already assigned — skip

  const instType = (ld.campuses as any)?.institutions?.type;
  let teamName: string;
  if (ld.campus_id === MIRAI_CAMPUS_ID) {
    teamName = "Mirai Admissions";
  } else if (instType === "school") {
    teamName = "NSAEII Admissions";
  } else {
    teamName = "Grn Counselling";
  }

  // Fetch team members
  const teamRes = await fetch(
    `${SUPABASE_URL}/rest/v1/teams?name=eq.${encodeURIComponent(teamName)}&select=id,team_members(user_id)&limit=1`,
    { headers: h },
  );
  const team = (await teamRes.json().catch(() => []))?.[0];
  const memberUserIds: string[] = (team?.team_members || []).map((m: any) => m.user_id);
  if (memberUserIds.length === 0) {
    console.warn(`[RoundRobin] No members in team "${teamName}" for lead ${leadId}`);
    return null;
  }

  // Resolve user_ids → profile ids
  const profRes = await fetch(
    `${SUPABASE_URL}/rest/v1/profiles?user_id=in.(${memberUserIds.join(",")})&select=id`,
    { headers: h },
  );
  const profiles: { id: string }[] = await profRes.json().catch(() => []);
  const profileIds = profiles.map(p => p.id);
  if (profileIds.length === 0) return null;

  // Round-robin: pick the counsellor with fewest active leads
  const lcRes = await fetch(
    `${SUPABASE_URL}/rest/v1/leads?counsellor_id=in.(${profileIds.join(",")})&stage=not.in.(admitted,rejected,not_interested)&select=counsellor_id`,
    { headers: h },
  );
  const activeLeads: { counsellor_id: string }[] = await lcRes.json().catch(() => []);
  const countMap: Record<string, number> = {};
  for (const pid of profileIds) countMap[pid] = 0;
  for (const l of activeLeads) {
    if (countMap[l.counsellor_id] !== undefined) countMap[l.counsellor_id]++;
  }
  const sorted = Object.entries(countMap).sort((a, b) => a[1] - b[1]);
  const assignedProfileId = sorted[0]?.[0] ?? null;
  if (!assignedProfileId) return null;

  // Assign on lead
  await fetch(`${SUPABASE_URL}/rest/v1/leads?id=eq.${leadId}`, {
    method: "PATCH",
    headers: { ...h, Prefer: "return=minimal" },
    body: JSON.stringify({ counsellor_id: assignedProfileId }),
  });

  console.log(`[RoundRobin] Lead ${leadId} → team "${teamName}", counsellor ${assignedProfileId}`);

  // Fire lead_assigned automation (async)
  fireAutomation("lead_assigned", leadId).catch(() => {});

  return assignedProfileId;
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

/** Detect promises made in the AI transcript and cross-reference with tools actually called. */
interface ReconcileResult {
  templateKey: string;
  templateParams: string[];
  buttonUrls?: string[];
  phone?: string;
  actions: string[]; // what reconciliation did, for logging
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

  // 2. Callback promised but request_human_callback not called → create followup
  if (callbackPromised && !callbackDone) {
    await fetch(`${SUPABASE_URL}/rest/v1/lead_followups`, {
      method: "POST", headers: { ...dbHeaders, Prefer: "return=minimal" },
      body: JSON.stringify({
        lead_id: leadId, scheduled_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        type: "call", notes: "🤖 Post-call reconciliation: AI promised human callback but didn't call the tool.", status: "pending",
      }),
    });
    await fetch(`${SUPABASE_URL}/rest/v1/lead_notes`, {
      method: "POST", headers: { ...dbHeaders, Prefer: "return=minimal" },
      body: JSON.stringify({ lead_id: leadId, content: "🤖 Post-call reconciliation: Human callback followup created — AI promised but didn't call request_human_callback." }),
    });
    await assignLeadRoundRobin(leadId);
    actions.push("callback_followup_created");
  }

  // ── Determine WhatsApp template (priority: visit > callback > course_info) ──
  if (waSent) {
    // AI already sent a WhatsApp during the call — only log reconciliation actions
    if (actions.length > 0) {
      return { templateKey: "", templateParams: [], actions };
    }
    return null;
  }

  // Fetch lead info for WA params
  const waLeadRes = await fetch(
    `${SUPABASE_URL}/rest/v1/leads?id=eq.${leadId}&select=phone,name,courses:course_id(name,slug),campuses:campus_id(name)`,
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
    actions.push("wa:missed_call");
    return { templateKey: "missed_call", templateParams: [waLd.name, cn], phone: waLd.phone, actions };
  }

  if (disposition === "not_interested" || disposition === "do_not_contact" || disposition === "wrong_number") {
    return actions.length > 0 ? { templateKey: "", templateParams: [], actions } : null;
  }

  // Default for interested / no disposition / partial conversation: send course info
  actions.push("wa:ai_call_course_info");
  return { templateKey: "ai_call_course_info", templateParams: [waLd.name, cn, cm, courseLink, applyLink], phone: waLd.phone, actions };
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

        // Assign counsellor via round-robin for actionable dispositions
        const needsAssignment = ["interested", "callback_requested", "call_back", "partial_conversation"].includes(args.disposition);
        if (needsAssignment) {
          await assignLeadRoundRobin(callCtx.leadId);
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

          await fetch(`${SUPABASE_URL}/rest/v1/lead_followups`, {
            method: "POST",
            headers: { ...headers, Prefer: "return=minimal" },
            body: JSON.stringify({
              lead_id: callCtx.leadId,
              scheduled_at: followupDate,
              type: "call",
              notes: `🤖 AI call outcome: ${args.disposition.replace(/_/g, " ")}. ${args.notes || "Counsellor follow-up required."}`,
              status: "pending",
            }),
          });
          console.log(`[Followup] Scheduled for ${callCtx.leadId}: ${args.disposition} → ${followupDate}`);
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

        // Get lead phone and course info
        const waLeadRes = await fetch(
          `${SUPABASE_URL}/rest/v1/leads?id=eq.${callCtx.leadId}&select=phone,name,course_id,courses:course_id(name,slug),campuses:campus_id(name)`,
          { headers },
        );
        const waLead = (await waLeadRes.json())?.[0];
        if (!waLead?.phone) return { success: false, message: "Lead has no phone" };

        const waCourse = args.course_name || (waLead.courses as any)?.name || "our programmes";
        const waSlug = (waLead.courses as any)?.slug || "";
        const waCampus = args.campus_name || (waLead.campuses as any)?.name || "NIMT campus";
        const courseUrl = waSlug ? `https://www.nimt.ac.in/courses/${waSlug}` : "https://www.nimt.ac.in/courses";
        const applyUrl = "https://uni.nimt.ac.in/apply/nimt";

        let waTemplateKey = "";
        let waParams: string[] = [];
        let waButtonUrls: string[] | undefined;

        switch (args.message_type) {
          case "course_info":
          case "apply_link":
            waTemplateKey = "ai_call_course_info";
            waParams = [waLead.name, waCourse, waCampus, courseUrl, applyUrl];
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
                voiceName: "Kore",
              },
            },
            languageCode: "en-IN",
          },
        },
        realtimeInputConfig: {
          automaticActivityDetection: {
            prefixPaddingMs: 300,
            silenceDurationMs: 1500,
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

  // Inbound call answer URL — handles callbacks from leads (must be before generic /answer/)
  if (path === "/answer/inbound") {
    const body = await req.formData().catch(() => null);
    const params = body ? Object.fromEntries(body) : {} as any;
    const callerPhone = params.From || params.CallerName || "";
    const callId = `inbound-${crypto.randomUUID().slice(0, 8)}`;
    const host = req.headers.get("host") || url.host;
    const wsProtocol = host.includes("localhost") ? "ws" : "wss";

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
    try {
      const phone = callerPhone.replace(/[^0-9]/g, "").slice(-10);
      if (phone) {
        const res = await fetch(
          `${SUPABASE_URL}/rest/v1/leads?phone=ilike.*${phone}&select=id,name,course_id,courses:course_id(name),campuses:campus_id(name)&limit=1`,
          { headers: dbHeaders },
        );
        const leads = await res.json().catch(() => []);
        if (leads?.[0]) {
          leadId = leads[0].id;
          leadName = leads[0].name || "";
          courseName = (leads[0].courses as any)?.name || "";
          campusName = (leads[0].campuses as any)?.name || "";
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
      callerTranscript: [],
      aiTranscript: [],
      toolCallsMade: [],
    });

    const wsUrl = `${wsProtocol}://${host}/ws/${callId}`;
    const recordingCallbackUrl = SUPABASE_URL ? `${SUPABASE_URL}/functions/v1/voice-call-callback` : "";
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Record recordSession="true" redirect="false" maxLength="3600"${recordingCallbackUrl ? ` callbackUrl="${recordingCallbackUrl}" callbackMethod="POST"` : ""} />
  <Stream streamTimeout="600" keepCallAlive="true" bidirectional="true" contentType="audio/x-mulaw;rate=8000">${wsUrl}</Stream>
</Response>`;

    console.log(`[${callId}] Inbound answer XML for ${callerPhone}, lead: ${leadName || "unknown"}`);
    return new Response(xml, { headers: { "Content-Type": "application/xml" } });
  }

  // Plivo Answer URL (outbound) — returns XML with bidirectional Stream
  if (path.startsWith("/answer/")) {
    const callId = path.split("/answer/")[1];
    const host = req.headers.get("host") || url.host;
    // Always use wss:// in production (Cloud Run terminates TLS at load balancer, so url.protocol is http)
    const wsProtocol = host.includes("localhost") ? "ws" : "wss";

    const recordingCallbackUrl = SUPABASE_URL
      ? `${SUPABASE_URL}/functions/v1/voice-call-callback`
      : "";
    const wsUrl = `${wsProtocol}://${host}/ws/${callId}`;
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Record recordSession="true" redirect="false" maxLength="3600"${recordingCallbackUrl ? ` callbackUrl="${recordingCallbackUrl}" callbackMethod="POST"` : ""} />
  <Stream streamTimeout="600" keepCallAlive="true" bidirectional="true" contentType="audio/x-mulaw;rate=8000">${wsUrl}</Stream>
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

        const updates: Record<string, any> = {
          status: plivoStatus,
          plivo_call_uuid: params.CallUUID || params.ALegUUID || null,
          duration_seconds: parseInt(params.Duration) || 0,
          recording_url: params.RecordingUrl || null,
          transcript: fullTranscript,
          summary: summary,
          completed_at: new Date().toISOString(),
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
    const PLIVO_PHONE_NUMBER = Deno.env.get("PLIVO_PHONE_NUMBER") || "";
    const recordingCallbackUrl = SUPABASE_URL ? `${SUPABASE_URL}/functions/v1/voice-call-callback` : "";
    const host = req.headers.get("host") || url.host;
    const statusUrl = `https://${host}/bridge-status/${callId}`;

    console.log(`[BRIDGE ${callId}] Counsellor answered, dialing student: ${studentPhone}`);

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Record recordSession="true" redirect="false" maxLength="3600"${recordingCallbackUrl ? ` callbackUrl="${recordingCallbackUrl}" callbackMethod="POST"` : ""} />
  <Speak voice="WOMAN">Connecting you to the student now.</Speak>
  <Dial callerId="${PLIVO_PHONE_NUMBER}" action="${statusUrl}" method="POST" machineDetection="true" machineDetectionTime="5000">
    <Number>${studentPhone}</Number>
  </Dial>
</Response>`;

    return new Response(xml, { headers: { "Content-Type": "application/xml" } });
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
    return new Response("OK");
  }

  // POST /bridge-hangup/{callId} — Plivo A-leg hangup (FINAL callback)
  // Creates ALL database records. Single source of truth.
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
    if (!callCtx?.leadId || !SUPABASE_URL) {
      if (callCtx) activeCallContexts.delete(callId);
      return new Response("OK");
    }

    const leadId = callCtx.leadId;
    const counsellorUserId = callCtx.toolCallsMade?.[0]?.args?.counsellorUserId || null;
    const counsellorName = callCtx.toolCallsMade?.[0]?.args?.counsellorName || "Counsellor";
    const statusRan = !!(callCtx as any)._statusRan;
    const disposition: string | null = (callCtx as any)._disp ??
      (callStatus === "cancel" ? "cancelled" : callStatus === "busy" ? "busy" : callStatus === "no-answer" ? "not_answered" : null);
    const dialStatus: string = (callCtx as any)._dialStatus ?? callStatus;
    const aLegUUID = (callCtx as any)._aLegUUID ?? plivoALegUUID;
    const bLegUUID: string = (callCtx as any)._bLegUUID ?? "";
    const isAuto = !!disposition;
    const isConnected = !disposition && (dialStatus === "completed" || callStatus === "completed");

    const dbH = { "Content-Type": "application/json", apikey: SUPABASE_SERVICE_KEY, Authorization: `Bearer ${SUPABASE_SERVICE_KEY}` };

    console.log(`[BRIDGE-HANGUP ${callId}] statusRan=${statusRan} disp=${disposition || "connected"} dur=${totalDuration} aLeg=${aLegUUID.slice(0,12)}`);

    // 1. call_logs (Call Log page)
    await fetch(`${SUPABASE_URL}/rest/v1/call_logs`, {
      method: "POST", headers: { ...dbH, Prefer: "return=minimal" },
      body: JSON.stringify({
        lead_id: leadId,
        disposition: disposition || (isConnected ? null : callStatus),
        duration_seconds: totalDuration,
        notes: isAuto ? `Cloud Call [${callId.slice(0,8)}]: ${disposition?.replace("_"," ")} (auto)` : `Cloud Call [${callId.slice(0,8)}]: connected (${totalDuration}s)`,
        direction: "outbound",
        user_id: counsellorUserId,
        called_at: new Date().toISOString(),
      }),
    }).catch(e => console.error(`[BRIDGE-HANGUP ${callId}] call_logs:`, e.message));

    // 2. ai_call_records (unified reporting + recording match)
    // Store A-leg UUID as plivo_call_uuid — recording callback uses A-leg UUID
    await fetch(`${SUPABASE_URL}/rest/v1/ai_call_records`, {
      method: "POST", headers: { ...dbH, Prefer: "return=minimal" },
      body: JSON.stringify({
        lead_id: leadId, call_uuid: callId, plivo_call_uuid: aLegUUID,
        status: callStatus, duration_seconds: totalDuration, disposition,
        summary: isAuto ? `Cloud Call: ${disposition?.replace("_"," ")} (auto)` : `Cloud Call: connected (${totalDuration}s) by ${counsellorName}`,
        call_type: "manual", completed_at: new Date().toISOString(),
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
