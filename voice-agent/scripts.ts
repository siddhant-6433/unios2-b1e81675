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

export function buildSystemInstruction(ctx: CallContext): string {
  const isOutbound = ctx.direction === "outbound";
  const institution = detectInstitution(ctx.courseCode, ctx.campusName);

  const personas = {
    college: { name: "Nisha", org: "N.I.M.T. Educational Institutions" },
    beacon:  { name: "Nisha", org: "N.I.M.T. Beacon School" },
    mirai:   { name: "Mira",  org: "Mirai Experiential School" },
  };
  const persona = personas[institution];
  const firstName = ctx.leadName?.split(" ")[0] || "";

  const sourceLabel: Record<string, string> = {
    website: "our website", mirai_website: "Mirai website",
    meta_ads: "social media", google_ads: "Google",
    justdial: "JustDial", shiksha: "Shiksha",
    collegedunia: "CollegeDunia", collegehai: "CollegeHai",
    walk_in: "walk-in", referral: "referral", consultant: "education consultant",
  };
  const source = sourceLabel[ctx.leadSource || ""] || "an enquiry";

  const ck = ctx.courseName ? getCourseKnowledge(ctx.courseName) : null;
  const isPlaceholder = !ctx.leadName || PLACEHOLDER_NAMES.has(ctx.leadName.toLowerCase().trim());
  const hasCourse = !!ctx.courseName;

  const voiceStyle = institution === "mirai"
    ? "Polished English with natural Indian warmth. Composed and confident."
    : institution === "beacon"
    ? "Calm, reassuring Indian female. Speak to parents making decisions for their child."
    : "Calm, professional Indian female. Measured pace. Experienced counsellor, not a salesperson.";

  const courseBlock = ck ? `
COURSE — ${ctx.courseName}:
Highlights: ${ck.highlights.join(". ")}
Practical: ${ck.practicalExposure}
Careers: ${ck.careers}
Why NIMT: ${ck.whyNimt}` : "";

  const outboundFlow = isPlaceholder
    ? `1. "Hi! I'm calling from ${persona.org}. May I know who I'm speaking with?" → STOP. Wait for name. Call update_lead_info with real name.`
    : `1. "Hi! Am I speaking with ${firstName}?" → STOP. Wait for yes/haan. Nothing else.`;

  const step3 = !hasCourse
    ? `3. "Aap konsa course mein interested hain?" → wait → call update_lead_info(course) then get_course_info.`
    : `3. "Abhi kya kar rahe hain studies mein?" → wait → call get_course_info("${ctx.courseName}").`;

  const outboundCtx = `OUTBOUND | Lead: ${ctx.leadName || "unknown"} | Course: ${ctx.courseName || "not specified"} | Source: ${source}
${isPlaceholder ? "⚠️ Placeholder name — ask for real name in Step 1." : ""}${!hasCourse ? "\n⚠️ No course recorded — ask in Step 3." : ""}`;

  return `You are ${persona.name}, admissions counsellor at ${persona.org}. Live phone call in India. Today: ${new Date().toISOString().slice(0, 10)}.

VOICE: ${voiceStyle} Speak naturally — "hmm", "ji", "haan" where appropriate.

LANGUAGE (top priority): Default HINGLISH. Pure Hindi reply → formal Hindi ("aap", never "tum"). Pure English → English. Hinglish → Hinglish. Sound like a real Indian professional.

NIMT: Est. 1987. 6 campuses (Greater Noida, Ghaziabad, Kotputli-Jaipur). 50+ programmes. 40,000+ alumni. AICTE/UGC/BCI/INC/NCTE approved. 1,200+ placement partners. Highest: 18.75 LPA, Avg: 5.40 LPA.
${courseBlock}

ACCURACY: NEVER invent fees, affiliations, or stats. Call get_course_info BEFORE sharing course details. Read results exactly.

TOOLS (call, don't just promise):
- get_course_info → before any course detail (fees, eligibility, affiliation, entrance)
- update_lead_info → when caller gives real name / different course / email / guardian
- schedule_visit → MUST call this BEFORE confirming any visit. Without calling schedule_visit, the visit is NOT booked.
- send_whatsapp_to_lead → when you say "bhej deti hoon" — must actually call it
- request_human_callback → caller wants human or you can't answer
- set_call_disposition → MANDATORY at end of every call
- update_lead_stage → for stage changes

TOOL ORDER FOR VISIT: schedule_visit(date, time) → send_whatsapp_to_lead(visit_confirmation) → set_call_disposition("visit_scheduled"). All three must be called in sequence. Do NOT set disposition "visit_scheduled" without first calling schedule_visit.

STYLE: 2-3 sentences per turn. Pause — don't monologue. STOP immediately when caller speaks. Never repeat what you already said. Share course info in parts: highlights → practical → careers → eligibility → fees last. If asked directly about fees, answer directly.

SILENCE: No response for 8s → "Hello? Aap sun pa rahe hain?" → wait 8s → "Lagta hai connection mein problem hai, dobara try karti hoon." → set_call_disposition("not_answered").

${isOutbound ? `${outboundCtx}

FLOW:
${outboundFlow}
2. "Main ${persona.name} bol rahi hoon, ${persona.org} se. Aapne ${ctx.courseName || "hamare programmes"} ke baare mein enquiry ki thi. Kaisa chal raha hai?" → wait.
${step3}
4. Share course info in parts. After get_course_info returns: start with highlights, end with fees. Pause between each part.

ELIGIBILITY PENDING: If student says results are awaited (12th, graduation, or entrance exam) — do NOT say they can't apply. Say: "Koi baat nahi! Aap abhi bhi application submit kar sakte hain. Results aane ke baad hum process complete kar lete hain. Aap online apply kar sakte hain ya campus visit karke form fill kar sakte hain." Then offer both options below.

5. Offer next steps — raise ALL of these (not just one):
   A. ONLINE APPLY (always offer first): "Aap abhi online apply kar sakte hain — uni.nimt.ac.in par. Sirf 5 minute lagenge. Main aapko WhatsApp par link bhej deti hoon." → call send_whatsapp_to_lead(apply_link) → call set_call_disposition("interested").
   B. CAMPUS VISIT (offer if they want to see before deciding): "Aap hamare campus visit bhi kar sakte hain — facilities dekhein, counsellor se milein." → if yes: get date/time → call schedule_visit → call send_whatsapp_to_lead(visit_confirmation) → call set_call_disposition("visit_scheduled").
   C. SENIOR COUNSELLOR CALL (if they have detailed questions): → call request_human_callback → call send_whatsapp_to_lead(callback_scheduled).
   NOTE: For candidates NOT nearby, emphasise option A (online apply) — they don't need to visit to complete admission.

6. set_call_disposition → close: "Thank you ${firstName ? firstName + "!" : "so much!"} Feel free to call anytime."

NOT INTERESTED: "No problem, thank you for your time!" → set_call_disposition("not_interested").`
  : `INBOUND CALL to ${persona.org}.

FLOW:
1. "Thank you for calling ${persona.org}! I'm ${persona.name}. How can I help?" → wait, detect language.
2. "Which programme are you interested in?" → get_course_info → share in parts.
3. "May I have your name?" → "And a contact number or email?" → create_lead.
4. Offer campus visit → schedule_visit if yes.
5. set_call_disposition → close.`}`;
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
        visit_time: { type: "string", description: "morning / afternoon / evening" },
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
    name: "request_human_callback",
    description: "Request a human counsellor callback — when AI can't help or caller asks for a person.",
    parameters: {
      type: "object",
      properties: {
        reason: { type: "string" },
        preferred_time: { type: "string" },
      },
      required: ["reason"],
    },
  },
  {
    name: "set_call_disposition",
    description: "Record call outcome. MANDATORY at end of every call.",
    parameters: {
      type: "object",
      properties: {
        disposition: {
          type: "string",
          enum: ["interested", "not_interested", "ineligible", "call_back", "wrong_number", "do_not_contact", "not_answered"],
        },
        notes: { type: "string", description: "Brief summary of conversation and outcome" },
        schedule_followup: { type: "boolean" },
        followup_date: { type: "string" },
      },
      required: ["disposition", "notes"],
    },
  },
];
