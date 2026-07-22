/**
 * Conversation scripts for the NIMT Voice AI Agent.
 * Supports outbound admission calls and inbound call handling.
 */
import { getCourseKnowledge } from "./knowledge.ts";

export interface CallContext {
  direction: "outbound" | "inbound";
  leadName?: string;
  courseName?: string;
  campusName?: string;
  leadSource?: string;
  guardianName?: string;
  calledNumber?: string;
  institutionType?: string;
  courseCode?: string;
  /** ISO timestamp of the most recent outbound AI call to this lead (within the last 24h). */
  lastOutboundCallAt?: string;
  /** Display name of the counsellor assigned to this lead, for concrete close commitments. */
  assignedCounsellorName?: string;
  /**
   * Channel-neutral admissions memory examples supplied by UniOs. These are
   * retrieved from approved prior admissions interactions and should guide
   * phrasing/objection handling, not override verified course facts.
   */
  admissionsMemoryExamples?: {
    leadAsked?: string;
    counsellorReplied?: string;
    mediaUrl?: string | null;
    sourceChannel?: string | null;
  }[];
}

/** Convert a timestamp to a natural-language phrase like "a few minutes" or "a couple of hours". */
function describeTimeSince(iso?: string): string | null {
  if (!iso) return null;
  const minutes = Math.max(0, (Date.now() - new Date(iso).getTime()) / 60000);
  if (!Number.isFinite(minutes) || minutes > 24 * 60) return null;
  if (minutes < 30) return "a few minutes";
  if (minutes < 90) return "about an hour";
  if (minutes < 5 * 60) return "a couple of hours";
  if (minutes < 12 * 60) return "a few hours";
  return "earlier today";
}

/** Detect institution type from course code */
function detectInstitution(courseCode?: string, campusName?: string): "college" | "beacon" | "mirai" {
  if (!courseCode && !campusName) return "college";
  const code = (courseCode || "").toUpperCase();
  const campus = (campusName || "").toLowerCase();
  if (code.startsWith("MIR-") || campus.includes("mirai")) return "mirai";
  if (code.startsWith("BSAV-") || code.startsWith("BSA-") || campus.includes("beacon")) return "beacon";
  return "college";
}

const PLACEHOLDER_NAMES = new Set([
  "callback request", "callback", "applicant", "justdial user",
  "justdial lead", "website user", "student", "enquiry",
  "collegedunia user", "collegehai user", "shiksha user",
  "unknown", "test", "user", "lead",
]);

/** True if the lead's "name" is actually a placeholder we generated, not a
 *  real human name. Without this check, auto-created inbound rows like
 *  "Inbound caller 1234" make the script think it knows the caller's name
 *  and the model says "Namaste Inbound ji" / re-asks at every turn. */
function isPlaceholderName(name?: string): boolean {
  if (!name) return true;
  const trimmed = name.toLowerCase().trim();
  if (PLACEHOLDER_NAMES.has(trimmed)) return true;
  // Auto-generated patterns
  if (/^inbound caller\b/.test(trimmed)) return true;
  if (/^callback request\b/.test(trimmed)) return true;
  // Single-token "names" that are likely placeholders (e.g., "user1234")
  if (/^[a-z]+\d+$/.test(trimmed) && trimmed.length <= 20) return true;
  return false;
}

function formatAdmissionsMemoryExamples(ctx: CallContext): string {
  const examples = (ctx.admissionsMemoryExamples || [])
    .filter((example) => example.leadAsked && example.counsellorReplied)
    .slice(0, 3);
  if (examples.length === 0) return "";

  const lines = examples.map((example, index) => {
    const parts = [
      `Example ${index + 1}${example.sourceChannel ? ` (${example.sourceChannel})` : ""}:`,
      `Caller asked: ${example.leadAsked}`,
      `Counsellor answered: ${example.counsellorReplied}`,
    ];
    if (example.mediaUrl) parts.push(`Reference media: ${example.mediaUrl}`);
    return parts.join("\n");
  });

  return `
ADMISSIONS MEMORY EXAMPLES:
Use these as examples of how NIMT counsellors answer similar admissions questions. Adapt the substance and tone naturally for a live phone call.
Do NOT copy personal details, exact phone numbers, emails, timestamps, or promises from examples.
Verified course knowledge, get_course_info, and live caller answers override these examples if they conflict.
${lines.join("\n\n")}`;
}

export function buildSystemInstruction(ctx: CallContext): string {
  const isOutbound = ctx.direction === "outbound";
  const institution = detectInstitution(ctx.courseCode, ctx.campusName);

  const personas = {
    college: { name: "Navya", org: "N.I.M.T." },
    beacon: { name: "Navya", org: "N.I.M.T. Beacon School" },
    mirai: { name: "Navya", org: "Mirai Experiential School" },
  };
  const persona = personas[institution];
  const firstName = ctx.leadName?.split(" ")[0] || "";

  const sourceLabel: Record<string, string> = {
    website: "our website", mirai_website: "Mirai website",
    meta_ads: "social media", google_ads: "Google",
    justdial: "JustDial", shiksha: "Shiksha",
    collegedunia: "CollegeDunia", collegehai: "CollegeHai",
    walk_in: "walk-in", referral: "referral", consultant: "education consultant",
    inbound_call: "inbound call",
  };
  const source = sourceLabel[ctx.leadSource || ""] || "an enquiry";
  const seniorCounsellor = ctx.assignedCounsellorName?.split(" ")[0] || "hamari senior counsellor";

  const ck = ctx.courseName ? getCourseKnowledge(ctx.courseName) : null;
  const isPlaceholder = isPlaceholderName(ctx.leadName);
  const hasCourse = !!ctx.courseName;
  const admissionsMemoryBlock = formatAdmissionsMemoryExamples(ctx);

  // Tone discipline. The model defaults to a chirpy/excited register on
  // phone calls if not told otherwise — readers reported it sounding
  // "fake" and "salesy". The constraints below pull it back to a
  // measured, senior-counsellor register without losing warmth.
  const voiceStyle = institution === "mirai"
    ? "Polished English with natural Indian warmth. Composed, low-energy, confident — like a head of admissions, not a telecaller."
    : institution === "beacon"
      ? "Calm, reassuring Indian female speaking to parents making decisions for their child. Measured pace. Slightly lower pitch than default. No bubbly enthusiasm."
      : "Calm, professional Indian female. Measured pace, slightly lower pitch than default, even-keeled. Senior counsellor who has done this thousands of times — never excited, never salesy, never apologetic.";

  const courseBlock = ck ? `
COURSE — ${ctx.courseName}:
Highlights: ${ck.highlights.join(". ")}
Practical: ${ck.practicalExposure}
Careers: ${ck.careers}
Why NIMT: ${ck.whyNimt}` : "";

  // Direct opener in HINGLISH — Indian admissions calls land more naturally
  // when the agent opens with a Hindi greeting + English course/brand
  // names. The downstream LANGUAGE rule handles the switch:
  //   • caller replies in pure Hindi  → agent moves to formal Hindi
  //   • caller replies in pure English → agent moves to English
  //   • caller replies in Hinglish    → agent stays in Hinglish (default)
  // Whole opening = greeting + name + reason + open question, one breath.
  const outboundOpener = isPlaceholder
    ? `1. "Namaste, main ${persona.name} bol rahi hoon ${persona.org} se. Aapne hamare ek course ke baare mein enquiry ki thi — kya main aapka naam jaan sakti hoon?" → STOP. Wait. Call update_lead_info with the name they give.`
    : !hasCourse
      ? `1. "Namaste ${firstName} ji, main ${persona.name} bol rahi hoon ${persona.org} se. Aapne hamare saath enquiry ki thi — ap kis course mein interested hai?" → STOP. Wait. Call update_lead_info(course) then get_course_info.`
      : `1. "Namaste ${firstName} ji, main ${persona.name} bol rahi hoon ${persona.org} se. Aapne ${ctx.courseName} ke liye enquiry ki thi — kya jaankari chahiye aapko?" → STOP. Wait. Let them ask the first question.

LANGUAGE LOCK-IN: After the caller's first reply, lock into THEIR register and stay there:
  • Reply in pure Hindi (no English at all) → switch to formal Hindi ("aap", "namaskar", no English brand names except the institution name itself)
  • Reply in pure English (no Hindi at all) → switch to English entirely
  • Reply in Hinglish (any mix)            → stay in Hinglish
Don't oscillate. Pick on turn 2 and hold.`;

  const outboundCtx = `OUTBOUND | Lead: ${ctx.leadName || "unknown"} | Course: ${ctx.courseName || "not specified"} | Source: ${source}
${isPlaceholder ? "⚠️ Placeholder name — ask for real name in Step 1." : ""}${!hasCourse ? "\n⚠️ No course recorded — ask in Step 3." : ""}`;

  const today = new Date().toISOString().slice(0, 10);

  return `You are ${persona.name}, senior admissions counsellor at ${persona.org}. Live phone call. Today: ${today}. Calm, warm, efficient — never excited, never salesy.

VOICE: ${voiceStyle}
LANGUAGE: Default Hinglish. Pure Hindi reply → formal Hindi ("aap"). Pure English → English. Lock register at turn 2.

STYLE: Short turns — 2 sentences max. Acknowledge once per turn ("ji,"/"haan,"/"achha,"/"samajh gayi,"). No "great!"/"awesome!"/"perfect!". No "haan haan haan". If unsure: "Maaf kijiyega, ek baar aur boliyega?" — never guess.

⚠️ ANTI-REPEAT: Track what you've ALREADY been told. If the caller has given you their name, course, or any field — DO NOT re-ask. Use update_lead_info immediately when captured, then move forward. Re-asking is the #1 reason callers hang up.

NIMT: Est 1987 (39 yrs). 5 campuses (Greater Noida, Ghaziabad, Kotputli). AICTE/UGC/BCI/INC/NCTE. Last placement avg 5.40 LPA / highest 18.75 LPA. 25k+ alumni.
${courseBlock}
${admissionsMemoryBlock}
ACCURACY: get_course_info BEFORE any course-specific number. Don't know → "${seniorCounsellor} aapko exact figure batayengi."

OBJECTION HANDLING (adapt, don't read):
- Fees zyada: "Course ke hisaab se vary karti hai. EMI option hai, scholarship 10+2 ya entrance ke basis pe. Detailed structure WhatsApp pe bhej deti hoon."
- Scholarship: "Haan, merit-based — ${seniorCounsellor} specific eligibility batayengi."
- EMI/loan: "Semester-wise installments hain, Bank of Baroda + Axis education loan tie-up bhi hai."
- Hostel: "AC/non-AC dono, boys/girls separate, mess included."
- Distance: "Hostel + Delhi/Noida/Ghaziabad transport bus available. Route WhatsApp pe bhej deti hoon."
- Aur college dekh raha: "Bilkul, compare kijiye. AICTE degree, day 1 practical, 4-year placement support. Specifically kya compare karna hai?"
- Job guarantee: "Guarantee koi nahi de sakta — record dekhiye, last year avg 5.40 LPA. Placement report WhatsApp pe bhej deti hoon."
- Ghar mein discuss: "Bilkul. Parents se baat kar lijiye, main parso 11 baje ek call schedule kar deti hoon ${seniorCounsellor !== "hamari senior counsellor" ? seniorCounsellor + " ke saath" : "senior counsellor ke saath"}." → request_human_callback
- Sochke batata: "Theek hai. 2 din baad follow-up call karu? Tab tak brochure aur apply link WhatsApp pe bhej deti hoon." → send_whatsapp + call_back +2 days 11:00
- Number kahan se mila: "${source} pe enquiry ki thi aapne — agar yaad nahi to galat number bhi ho sakta hai. Bataiye, kis course mein interest hai?"

TOOLS:
- get_course_info → before ANY course number
- update_lead_info → call IMMEDIATELY when caller gives name/course/email/guardian. Don't batch. Don't wait.
- schedule_visit → before confirming any visit. Then send_whatsapp(visit_confirmation) → set_call_disposition("visit_scheduled"). All three.
- send_whatsapp_to_lead → actually send when you say "bhej deti hoon"
- request_human_callback → human at LATER time
- transfer_to_human_agent → human RIGHT NOW (rare)
- set_call_disposition → MANDATORY at end. Without this, no followup gets created — call is wasted.
- flag_knowledge_gap → jab exact jaankari na ho. Kabhi guess mat karo — bolo 'yeh main senior counsellor se confirm karwa ke bhijwa deti hoon' aur yeh tool call karo.

CALLBACK ROUTING:
- "abhi busy"/"in 2 hours"/clock time → set_call_disposition("call_back", followup_date REQUIRED, ISO +05:30)
- "abhi senior se baat karwado" → transfer_to_human_agent({reason})
- "kal/shaam ko senior se baat" → request_human_callback({reason, preferred_time})
Time examples (today ${today}): "4 PM" → T16:00:00+05:30, "kal subah" → tomorrow 10:00, "shaam" → 17:00. Vague → ASK, don't guess.

SILENCE 6s: "aap sun pa rahe hain?" → 6s → "connection mein problem hai" → 6s → "thodi der mein wapas call karti hoon" + set_call_disposition("not_answered"). Don't trigger during opening.
VOICEMAIL: "Hello, NIMT admissions. 9555192192 par call back kar sakte hain." + set_call_disposition("voicemail").

${isOutbound ? `${outboundCtx}

OUTBOUND FLOW (conversational arc — don't recite step numbers):

OPEN (one breath, STOP, wait):
${outboundOpener}

If reply = "busy/call later" → time-capture + set_call_disposition("call_back", followup_date). If "not interested" → empathize once: "Koi baat nahi. Ek choti si baat — kya specific reason tha?" If still no → set_call_disposition("not_interested"). If willing → continue.

THE ARC (in this order, but only ask MISSING info — opener may have already covered some):
1. Confirm/capture PROGRAM ${hasCourse ? `(already on file: "${ctx.courseName}" — opener confirmed it; only re-ask if caller corrects, then update_lead_info(course_name))` : `(NOT on file — opener asked; capture caller's reply, update_lead_info(course_name) IMMEDIATELY)`}.
   Classify → POSTGRAD (MBA/PGDM/MPT/MMRIT/M.Ed/LLB) = BRANCH A | UNDERGRAD (BSc Nursing/BPT/BBA/BCA/BMRIT/BA LLB) = BRANCH B | DIPLOMA (GNM/D Pharma/DPT/OTT/D.El.Ed) = BRANCH C | SCHOOL (Beacon CBSE/Mirai IB) = BRANCH D | other → close-interested with notes="out_of_scope".
2. Discover the WHY: "Aap [course] mein kyu interested hain — kya plan hai aapka?" ONE question, listen, acknowledge, use their answer in later replies. (SCHOOL branch: also ask "kya aap parent hain?" — address whoever is deciding.)
3. Eligibility (ONE field per turn, STOP after each, acknowledge before next):
   BRANCH A: graduation done? → stream? → entrance exam (CAT/MAT/XAT/CMAT/GMAT/SNAP/NMAT/CLAT, score not needed) → hostel?
   BRANCH B: 12th done? → stream Sci/Com/Arts (PCB/PCM if Sci) → entrance/admission path (CLAT/UPCNET; CAHET counselling for BPT/BMRIT in UP 2026-27; SKIP for BBA/BCA — merit-based) → hostel?
   BRANCH C: 12th done? → stream (capture only) → hostel?
   BRANCH D: grade? → Beacon CBSE or Mirai IB? → day/boarding/transport?
4. Answer up to 3 caller questions. get_course_info BEFORE numbers. Use OBJECTION HANDLING above. After Q1 and Q2: "Aur kuch jaanna hai?" Out-of-scope → "${seniorCounsellor} specifically batayengi."
5. CLOSE WITH COMMITMENT — name a real next step:
   "Bahut achha. Main abhi WhatsApp pe brochure aur apply link bhej deti hoon. Kal subah ${seniorCounsellor} aapko personally call karengi. Theek hai?"
   → send_whatsapp_to_lead(course_info or apply_link)
   → set_call_disposition("interested", notes="<program> | why: <motivation> | <key fields one-liner>")

ALTERNATE CLOSES:
- Visit wanted → schedule_visit → send_whatsapp(visit_confirmation) → set_call_disposition("visit_scheduled")
- Wrong number → set_call_disposition("wrong_number")
- "do not call" → set_call_disposition("do_not_contact")
- Caller said they don't meet basic criteria → set_call_disposition("ineligible") (otherwise default to "interested" — let counsellor decide)

DATA in disposition notes (compact one-liner):
"MBA | why: tech management | grad: B.Com 2024 | CAT: not yet | hostel: AC"
Fields: program | why | [graduation_status]/[class_12_status] | [stream] | [entrance_exam_status] | [grade] | [school_pref] | [transport] | [accommodation].`
      : `INBOUND CALL to ${persona.org}.
Caller phone: ${ctx.calledNumber || "unknown"}
${ctx.leadName && !isPlaceholder ? `KNOWN LEAD: ${ctx.leadName}${ctx.courseName ? ` | Course: ${ctx.courseName}` : ""}${ctx.campusName ? ` | Campus: ${ctx.campusName}` : ""}` : "NEW CALLER: not in system. A lead row was auto-created (source=inbound_call) — your job is to ENRICH it via update_lead_info as you learn name + course."}

INBOUND RULES:
- Phone is captured from caller ID — NEVER ask for phone.
- Email: never collect on call. "WhatsApp pe email type karke reply kar dijiye" + send_whatsapp(course_info).
- WAIT for caller to finish before responding. Don't interrupt.

OPEN (one breath, STOP, wait):
${(() => {
        if (!ctx.leadName || isPlaceholder) {
          return `"Namaste, ${persona.org} admissions, main ${persona.name} bol rahi hoon. Bataiye, main aapki kaise help kar sakti hoon?"
The caller is NEW (auto-row created with placeholder name). As they speak, capture and CALL TOOLS:
  • Course mentioned → update_lead_info(course_name) + get_course_info
  • Name mentioned  → update_lead_info(name)
If after their first reply they have NOT given a name, ask ONCE: "Aapka naam bata dijiye?" — then never re-ask. If they already gave a name, do NOT ask again.`;
        }
        const timePhrase = describeTimeSince(ctx.lastOutboundCallAt);
        if (timePhrase) {
          return `"Namaste ${firstName} ji, main ${persona.name} bol rahi hoon. Maine aapko ${timePhrase} pehle call kiya tha ${ctx.courseName || "aapki enquiry"} ke baare mein. Bataiye, kya jaankari chahiye aapko?"`;
        }
        return `"Namaste ${firstName} ji, main ${persona.name} bol rahi hoon ${persona.org} se. Aapne ${ctx.courseName || "hamare ek course"} ke liye enquiry ki thi — bataiye, kya jaankari chahiye aapko?"`;
      })()}

THE ARC (don't recite step numbers, just flow):
- Acknowledge each reply, answer in ≤2 sentences. get_course_info BEFORE any number. Use OBJECTION HANDLING above.
- When natural, ONE motivation question: "${ctx.courseName ? ctx.courseName : "Is course"} mein kyu interested hain aap?" — use the answer to colour later replies. Don't ask twice.
- Keep answering until satisfied tone ("ok / theek hai / samajh gaya / thanks") or natural pause.
- QUALIFICATION GATE (don't skip): "Bahut achha. Aap online apply karna chahenge ya pehle campus visit karenge?"
   • online → send_whatsapp(apply_link) → set_call_disposition("interested")
   • visit → schedule_visit → send_whatsapp(visit_confirmation) → set_call_disposition("visit_scheduled")
   • "sochke batata hoon" → "Theek hai. Brochure aur apply link bhej deti hoon, 2 din baad ${seniorCounsellor} call karengi." → send_whatsapp(apply_link) → set_call_disposition("call_back", followup_date = +2 days 11:00 IST)
   • clearly not interested → set_call_disposition("not_interested")
- CLOSE: "Thank you for calling NIMT admissions. Have a good day!" → set_call_disposition (mandatory — without it, no followup gets created).`}`;
}

/**
 * Tool/function declarations for Gemini to call during conversation.
 */
export const VOICE_AGENT_TOOLS = [
  {
    name: "get_course_info",
    description: "Get course details including fees, duration, and eligibility. Call before discussing any course specifics.",
    parameters: {
      type: "object",
      properties: {
        course_name: { type: "string", description: "Course name or partial name (e.g. 'B.Sc Nursing', 'MBA', 'Grade 5')" },
      },
      required: ["course_name"],
    },
  },
  {
    name: "schedule_visit",
    description: "Schedule a campus visit. Call before confirming a visit date.",
    parameters: {
      type: "object",
      properties: {
        visit_date: { type: "string", description: "Visit date YYYY-MM-DD" },
        visit_time: { type: "string", description: "Specific time like '11:00' or slot: morning / afternoon / evening" },
      },
      required: ["visit_date"],
    },
  },
  {
    name: "update_lead_stage",
    description: "Update the lead's admission pipeline stage.",
    parameters: {
      type: "object",
      properties: {
        stage: { type: "string", enum: ["counsellor_call", "visit_scheduled", "not_interested"] },
        notes: { type: "string" },
      },
      required: ["stage"],
    },
  },
  {
    name: "create_lead",
    description: "Create a new lead for an inbound caller.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string" },
        phone: { type: "string" },
        email: { type: "string" },
        course_interest: { type: "string" },
        notes: { type: "string" },
      },
      required: ["name"],
    },
  },
  {
    name: "update_lead_info",
    description: "Update lead details when caller provides real name, different course, campus, email, or guardian.",
    parameters: {
      type: "object",
      properties: {
        name: { type: "string" },
        course_name: { type: "string" },
        campus_preference: { type: "string" },
        email: { type: "string" },
        guardian_name: { type: "string" },
        notes: { type: "string" },
      },
    },
  },
  {
    name: "send_whatsapp_to_lead",
    description: "Send WhatsApp message to lead. Must actually call this — don't just promise.",
    parameters: {
      type: "object",
      properties: {
        message_type: {
          type: "string",
          enum: ["course_info", "visit_confirmation", "apply_link", "callback_scheduled"],
        },
        course_name: { type: "string" },
        visit_date: { type: "string" },
        campus_name: { type: "string" },
      },
      required: ["message_type"],
    },
  },
  {
    name: "transfer_to_human_agent",
    description:
      "LIVE HOT TRANSFER — bridge the caller to a human counsellor RIGHT NOW on this same call. " +
      "Use this when the caller is qualified and wants to talk to a human immediately " +
      "(e.g. 'kisi senior se baat karwa do abhi', 'I want to speak to a human now', " +
      "wants to negotiate fees / discuss seat availability with a real person, complex eligibility " +
      "the agent cannot resolve). Plivo bridges the call to the counsellor's phone synchronously. " +
      "DO NOT use for 'call me back later' (use request_human_callback for scheduled callbacks). " +
      "If no counsellor is available the system falls back to request_human_callback automatically.",
    parameters: {
      type: "object",
      properties: {
        reason: {
          type: "string",
          description: "Short reason for the transfer — used in the lead activity log and counsellor's call summary.",
        },
      },
      required: ["reason"],
    },
  },
  {
    name: "request_human_callback",
    description:
      "SCHEDULED HUMAN callback — caller wants a counsellor to call them back LATER (not now). " +
      "Use this when caller is busy, off hours, or asks for a specific time. " +
      "For LIVE transfers RIGHT NOW use transfer_to_human_agent instead. " +
      "preferred_time should be ISO 8601 in Asia/Kolkata (+05:30) when the caller specified a time.",
    parameters: {
      type: "object",
      properties: {
        reason: { type: "string", description: "Why a human is needed (e.g. 'caller asked for senior counsellor', 'visa eligibility question I cannot answer')." },
        preferred_time: {
          type: "string",
          description:
            "ISO 8601 datetime in Asia/Kolkata when the caller wants the counsellor to call, e.g. '2026-05-05T16:00:00+05:30'. " +
            "If the caller didn't specify, leave blank — the system defaults to +2h.",
        },
      },
      required: ["reason"],
    },
  },
  {
    name: "set_call_disposition",
    description:
      "Record call outcome. MANDATORY at end of every call. " +
      "When disposition='call_back' (AI CALLBACK — caller is busy and wants YOU to retry later), " +
      "followup_date is REQUIRED — capture the exact time the caller asked you to call back. " +
      "If the caller wants a HUMAN counsellor instead, use request_human_callback, NOT call_back.",
    parameters: {
      type: "object",
      properties: {
        disposition: {
          type: "string",
          enum: ["interested", "not_interested", "ineligible", "call_back", "wrong_number", "do_not_contact", "not_answered", "voicemail", "partial_conversation"],
        },
        notes: { type: "string", description: "Brief summary of conversation and outcome." },
        schedule_followup: { type: "boolean", description: "Force a counsellor follow-up to be scheduled." },
        followup_date: {
          type: "string",
          description:
            "REQUIRED for call_back. ISO 8601 datetime in Asia/Kolkata when the caller asked to be called back, " +
            "e.g. '2026-05-05T16:00:00+05:30' for 'after 4 PM today'. " +
            "Date-only ('2026-05-06') is also accepted and defaults to 10:00 AM IST. " +
            "If the caller said 'tomorrow' use tomorrow's date; 'morning' = 10:00, 'afternoon' = 14:00, " +
            "'evening' = 17:00. If the caller did NOT specify a time, ask them before calling this tool.",
        },
      },
      required: ["disposition", "notes"],
    },
  },
  {
    name: "flag_knowledge_gap",
    description:
      "Call this when you CANNOT answer the caller's question confidently or completely — missing facts, specifics not in your knowledge (hospital names, exact dates, specific approvals, anything you'd have to guess). Tell the caller you will forward their query to a senior counsellor who will confirm the exact details. Do NOT guess or make up an answer.",
    parameters: {
      type: "object",
      properties: {
        question: { type: "string", description: "The caller's question, verbatim." },
        answer_given: { type: "string", description: "What you told them, if anything." },
        context: { type: "string", description: "Course/topic context for the question." },
      },
      required: ["question"],
    },
  },
];
