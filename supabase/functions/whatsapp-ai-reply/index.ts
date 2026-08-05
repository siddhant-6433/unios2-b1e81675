import { createClient } from "npm:@supabase/supabase-js@2";
import {
  digits,
  sendWhatsAppText as rawSendWhatsAppText,
  type WhatsAppChannelHint,
  type WhatsAppSendResult,
} from "../_shared/whatsapp-channel.ts";
import { logWhatsAppAutomationEvent } from "../_shared/whatsapp-automation-events.ts";
import { createWhatsAppAgUiTrace } from "../_shared/copilotkit-agui.ts";
import {
  conversationBusinessKey,
} from "../_shared/whatsapp-conversation-state.ts";
import { applyLeadTransition } from "../_shared/lead-transition.ts";
import { recordOutboundConversationAction } from "../_shared/whatsapp-conversation-action.ts";
import {
  FEE_STRUCTURE_URL,
  loadVerifiedAdmissionsContext,
} from "../_shared/nimt-admissions-context.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ─── AI failure visibility ──────────────────────────────────────────────────
// A failed AI dispatch used to write nothing at all, so a total outage (e.g. the
// Gemini billing 403 of 2026-08-02) was invisible in the inbox for days. Write a
// failed outbound row so the existing red "Message failed" bubble renders.
//
// ponytail: dedup is "one failed bubble per inbound turn" — the buffer worker
// retries every 2 min, so without it a stuck conversation grows hundreds of
// bubbles. Keyed off the newest inbound message rather than a new table.
async function recordAiFailureBubble(
  admin: { from: (table: string) => any },
  args: {
    phone: string;
    leadId: string | null;
    provider: "meta" | "plivo";
    businessPhoneNumberId: string | null;
    businessNumber: string | null;
    reason: string;
    detail?: unknown;
    content?: string | null;
  },
): Promise<void> {
  const waPhone = digits(args.phone);
  if (!waPhone) return;

  try {
    const { data: lastInbound } = await admin
      .from("whatsapp_messages")
      .select("created_at")
      .eq("phone", waPhone)
      .eq("direction", "inbound")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    // Already flagged this turn? Stay quiet.
    if (lastInbound?.created_at) {
      const { data: existingFailure } = await admin
        .from("whatsapp_messages")
        .select("id")
        .eq("phone", waPhone)
        .eq("direction", "outbound")
        .eq("template_key", "ai_auto_reply")
        .eq("status", "failed")
        .gt("created_at", lastInbound.created_at)
        .limit(1)
        .maybeSingle();
      if (existingFailure?.id) return;
    }

    await admin.from("whatsapp_messages").insert({
      lead_id: args.leadId,
      direction: "outbound",
      phone: waPhone,
      message_type: "text",
      content: args.content || null,
      template_key: "ai_auto_reply",
      status: "failed",
      is_read: true,
      provider: args.provider,
      business_phone_number_id: args.businessPhoneNumberId,
      business_phone_number: args.businessNumber,
      status_error: {
        error: { code: "ai_reply_failed", message: args.reason },
        ...(args.detail === undefined ? {} : { detail: args.detail }),
      },
    });
  } catch (err) {
    // Never let the failure recorder mask the original failure.
    console.error("recordAiFailureBubble failed:", err);
  }
}

// ─── NIMT Knowledge Base ────────────────────────────────────────────────────

const KNOWLEDGE_BASE = `
NIMT (National Institute of Management and Technology) — founded 1987.
21 Higher Education Programs at 11 Colleges across 5 Campuses in Greater Noida (UP), Ghaziabad (UP), and Kotputli Jaipur (Rajasthan). 36+ programmes total.
Tagline: "Where Ambition Meets Action"

APPROVALS & AFFILIATIONS:
Approved by: AICTE, UGC, Bar Council of India (BCI), NCTE, Indian Nursing Council (INC), Pharmacy Council of India (PCI)
Affiliated to: AKTU, GGSIPU, ABVMU (Atal Bihari Vajpayee Medical University), ALU (Dr. Bhimrao Ambedkar Law University), CCSU, University of Rajasthan

RANKINGS & RECOGNITION:
- #1 in UP — EW Higher Education Rankings
- Ranked 34th B-School — Business India
- AA+ rated — Digital Learning Magazine
- 6 institutions NIRF ranked 2025
- #57 Law in India — India Today 2025
- PGDM ranked #8 in India

PLACEMENTS:
1,200+ corporate partners. 60+ companies visit campus annually.
Highest package: INR 18.75 LPA | Average: INR 5.40 LPA
Top recruiters: Fortis, KPMG, Cognizant, ICICI Bank, Wipro, HCL, Dell, Airtel, Kotak Mahindra, Infosys, Deloitte, TCS

CAMPUSES:
1. Greater Noida (Main) — Plot No. 41, Knowledge Park-1, Near Pari Chowk, Greater Noida, UP 201310. Houses: PGDM, MBA, BPT, BSc Nursing, BCA, BA LLB, LLB, D Pharma, BMRIT, GNM. On-campus parent hospital for clinical training.
2. Ghaziabad Arthala — Near Arthala Metro Station, GT Road, Mohan Nagar, Ghaziabad 201007. NIMT Institute of Technology and Management. BBA, B.Ed, PGDM, MBA.
3. Ghaziabad Avantika — Ansal Avantika Colony, Shastri Nagar, Ghaziabad 201015. NIMT Beacon School (CBSE), B.Ed institutions.
4. Ghaziabad Avantika II — Avantika Extension Colony, Ghaziabad. Residential and day school campus.
5. Kotputli Jaipur — SP-3-1, RIICO Industrial Area, Keshwana, Kotputli, Jaipur 303108. 20-acre campus. Law, Management, Pharmacy, B.Ed. Affiliated to University of Rajasthan.

COURSES:

B.Sc Nursing:
- Duration: 4 Years (8 Semesters) + 6-month paid internship (Rs 10,000/month stipend)
- Campus: Greater Noida, Kotputli (Jaipur)
- Approved by: Indian Nursing Council (INC) | Affiliated to ABVMU
- Eligibility: 10+2 with Physics, Chemistry, Biology and English. Min 45%. Age 17+. Medically fit.
- Entrance: UPCNET / CPNET / merit-based
- Placements: Highest Rs 10 LPA, Average Rs 3 LPA. ~98% placement rate.
- Clinical training at NIMT's own parent hospital + GIMS, Navin Hospital, Manipal Hospital, VIMHANS Delhi, IHBAS Delhi

GNM (General Nursing & Midwifery):
- Duration: 3 Years + 6-month Internship
- Campus: Greater Noida
- UNIQUE: Open to Arts and Commerce students — Science NOT mandatory
- Eligibility: 10+2 from ANY stream. Min 40%. Age 17-35.
- Entrance: UP GNM Entrance Test (UPGET) / merit-based

BPT (Bachelor of Physiotherapy):
- Duration: 5 Years (4 academic years + 1-year compulsory internship)
- Campus: Greater Noida
- Eligibility: 10+2 PCB/Botany & Zoology with English pass. Min 50% PCB aggregate (40% SC/ST/OBC-NCL/PwD). Age 17+.
- Admission: UP 2026-27 through CAHET counselling by ABVMU Lucknow; NEET UG exempt this year.
- NCAHP category: Physiotherapy Professional, ISCO Code 2264.
- Clinical training at NIMT hospital. 1-year internship rotations: Orthopaedics, Neurology, Surgery, Medicine, Physiotherapy.

MBA:
- Duration: 2 Years (4 Semesters) | AKTU affiliated | AICTE approved
- Campus: Greater Noida, Ghaziabad
- Specialisations: Finance, Marketing, HR, Operations, IT, International Business, Insurance & Banking, Agri Business
- Eligibility: Bachelor's degree, min 50% (45% SC/ST/OBC). Valid CAT/MAT/XAT/CMAT/GMAT/SNAP/NMAT score.
- Placements: Highest INR 18.75 LPA, Average INR 5.40 LPA. Ranked 34th B-School.

PGDM:
- Duration: 2 Years (4 Semesters), Full-time Residential | AICTE approved
- Campus: Greater Noida, Ghaziabad, Kotputli (Jaipur)
- Ranked #8 in India. 60 students per campus — small batches.
- Specialisations: HR, Marketing, Operations, International Business, Insurance & Banking, Foreign Trade, Agri Business
- Eligibility: Bachelor's degree, min 50% (45% reserved). Valid CAT/MAT/XAT/CMAT score.

BA LLB / LLB:
- BA LLB: 5 Years integrated | LLB: 3 Years
- Campus: Greater Noida (main), Kotputli (Jaipur)
- Approved by Bar Council of India (BCI) | #57 Law in India (India Today 2025)
- BA LLB Eligibility: 12th pass, min 45%. Entrance: CLAT, LSAT, ULSAT.
- LLB Eligibility: Graduation any stream, min 45% (40% SC/ST/OBC). Merit-based / CLAT PG.
- Features: Moot Court room, Legal Aid clinic, MoU with CLAT Consortium

B.Ed:
- Duration: 2 Years (4 Semesters) | NCTE recognised
- Campus: Greater Noida (affiliated to CCSU), Ghaziabad Arthala, Kotputli Jaipur (NIMT Mahila B.Ed College — women's, University of Rajasthan)
- Eligibility: Arts/Science/Humanities graduates, min 50% (45% SC/ST). B.E./B.Tech: min 55%.
- Entrance: UP B.Ed JEE (Greater Noida/Ghaziabad), PTET (Kotputli)

BCA:
- Duration: 3 Years (6 Semesters) | Campus: Greater Noida
- Eligibility: 12th with Mathematics, min 45-50%.
- Entrance: Merit-based / JEECUP
- Technologies: C, C++, Java, Python, Web Dev, SQL, Cloud, Mobile Apps, Cybersecurity basics

BBA:
- Duration: 3 Years (6 Semesters) | Campus: Greater Noida, Ghaziabad Arthala
- Specialisations: Finance, Marketing, HR, Strategy & Entrepreneurship, International Business, Supply Chain
- Eligibility: 12th any stream, min 45%.
- Entrance: Merit-based (Class 12 marks). 120 student intake.

BMRIT (B.Sc Medical Radiology & Imaging Technology):
- Duration: 4 Years (including internship) | Campus: Greater Noida
- Eligibility: 10+2 PCB with English pass, min 50% PCB aggregate (40% SC/ST/OBC-NCL/PwD).
- Admission: UP 2026-27 through CAHET counselling by ABVMU Lucknow; NEET UG exempt this year.
- ISCO Code: 3211.
- Training in X-ray, CT scan, MRI, Ultrasound, Nuclear Medicine at NIMT hospital.

D Pharma:
- Duration: 2 Years + 3-month practical training | Campus: Greater Noida
- Approved by Pharmacy Council of India (PCI)
- Eligibility: 10+2 Science with PCB or PCM, min 50%.
- Entrance: JEECUP / merit-based. Pathway to B Pharma lateral entry.

NIMT Beacon School (K-12):
- CBSE affiliated | Campuses: Ghaziabad Arthala, Avantika / Avantika II
- Arthala monthly tuition: Nursery to Class I Rs 800, Class II-V Rs 950, Class VI-VIII Rs 1,150, Class IX-X Rs 1,450
- Arthala admission fee: Rs 0 for new and existing parents
- Smart classrooms, science labs, computer labs, sports, transport
- Day boarding with lunch: Rs 4,000/month. Boarding options available.
- Admission: Age-appropriate interaction/assessment

Mirai Experiential School (IB World School):
- IB PYP and MYP programmes | Campus: Ghaziabad
- Inquiry-based, experiential learning. Small class sizes. Bilingual (English + Hindi).
- Only IB World School in the region.
- Admission: Age-appropriate interaction

FEE STRUCTURE (First Year / Annual Fee):
Canonical fee page: https://nimt.ac.in/admissions/fees/
- B.Sc Nursing: ₹1,53,000/year | Greater Noida campus
- GNM: ₹1,18,000/year | Greater Noida campus
- BPT (Physiotherapy): ₹92,000/year | Greater Noida campus
- MBA: ₹1,30,000/year | Greater Noida campus
- PGDM: ₹2,25,000/year | Greater Noida & Kotputli campuses
- BA LLB (5-year integrated): ₹1,10,000/year | Greater Noida campus
- LLB (3-year): ₹44,250/year | Greater Noida & Kotputli campuses
- B.Ed: ₹56,000/year (Greater Noida & Ghaziabad) | ₹27,000/year (Kotputli)
- BCA: ₹75,000/year | Greater Noida campus
- BBA: ₹75,000/year | Greater Noida & Ghaziabad campuses
- BMRIT: ₹92,000/year | Greater Noida campus
- D.Pharma: ₹95,000/year | Greater Noida campus
- DPT (Diploma Physiotherapy): ₹62,000/year | Greater Noida campus
- D.El.Ed: ₹45,000/year | Ghaziabad campus
- OTT / D-OTT / DAOTT (Operation Theater Technician): Stetho Batch total ₹1,85,000 across 5 semesters | Sem 1 ₹40,000, Sem 2 ₹40,000, Sem 3 ₹40,000, Sem 4 ₹40,000, Sem 5 ₹25,000 | Greater Noida campus | ISCO Code 3259
- MPT (Masters Physiotherapy): ₹89,000/year | Greater Noida campus
- MMRIT (M.Sc Radiology): ₹89,000/year | Greater Noida campus
Note: These are first-year fees. Full year-wise programme fees are published at https://nimt.ac.in/admissions/fees/. Merit scholarships, category scholarships and education loan support may reduce the payable amount.

ADMISSIONS:
- Apply online: https://uni.nimt.ac.in/apply/nimt (also: apply.nimt.ac.in)
- Application fee: Rs 500-1,000 (varies by course)
- Application window: January–July | Admission deadline: September | Academic year: Aug/Sep
- Helpline: +91 9555192192

SCHOLARSHIPS:
- Merit-based scholarships for top academic performers
- Special scholarships for SC/ST/OBC categories
- Sports scholarships for national/state level athletes
- Nursing scholarships supported by INC guidelines
- Alumni referral discounts available
- Contact admissions office for current scholarship schemes: +91 9555192192

FACILITIES:
- Modern classrooms with smart boards
- Advanced labs (science, computer, clinical)
- Library with digital access
- On-campus parent hospital (Greater Noida campus) for nursing/paramedical students
- Hostels: 600+ capacity, AC and non-AC options, separate for boys and girls
- Cafeteria, gym, sports grounds
- Wi-Fi campus, transport facility
	`;

type SupabaseAdminClient = ReturnType<typeof createClient<Record<string, unknown>>>;
const sendWhatsAppText = rawSendWhatsAppText as unknown as (
  admin: SupabaseAdminClient,
  hint: WhatsAppChannelHint,
  to: string,
  text: string,
) => Promise<WhatsAppSendResult>;

interface AdmissionCourseOption {
  number: string;
  label: string;
  aliases: string[];
  codePrefixes: string[];
}

const ADMISSION_COURSE_OPTIONS: AdmissionCourseOption[] = [
  { number: "1", label: "B.Sc Nursing", aliases: ["bsc nursing", "b.sc nursing", "b sc nursing", "nursing"], codePrefixes: ["BSCN"] },
  { number: "2", label: "GNM", aliases: ["gnm", "general nursing"], codePrefixes: ["GNM"] },
  { number: "3", label: "BPT", aliases: ["bpt", "physiotherapy", "bachelor of physiotherapy"], codePrefixes: ["BPT"] },
  { number: "4", label: "BMRIT", aliases: ["bmrit", "radiology", "medical radiology", "imaging technology"], codePrefixes: ["BMRIT"] },
  { number: "5", label: "MBA", aliases: ["mba", "master of business administration"], codePrefixes: ["MBA"] },
  { number: "6", label: "PGDM", aliases: ["pgdm"], codePrefixes: ["PGDM"] },
  { number: "7", label: "BBA", aliases: ["bba", "bachelor of business administration"], codePrefixes: ["BBA"] },
  { number: "8", label: "BCA", aliases: ["bca", "bachelor of computer applications"], codePrefixes: ["BCA"] },
  { number: "9", label: "BA LLB / LLB", aliases: ["ba llb", "ballb", "llb", "law"], codePrefixes: ["BALLB", "LLB"] },
  { number: "10", label: "B.Ed", aliases: ["b.ed", "bed", "b ed", "bachelor of education"], codePrefixes: ["BED"] },
  { number: "11", label: "D Pharma", aliases: ["d pharma", "d.pharma", "d pharm", "dpharma", "diploma pharmacy"], codePrefixes: ["DPHARMA"] },
  { number: "12", label: "School admission", aliases: ["school", "beacon", "nursery", "kg", "class"], codePrefixes: ["BSA", "BSAV"] },
];

function normalizeText(value: string): string {
  return (value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function isPlaceholderLeadName(name: string | null | undefined, phone: string): boolean {
  const normalizedName = (name || "").replace(/[^0-9]/g, "");
  const normalizedPhone = (phone || "").replace(/[^0-9]/g, "");
  return !name || name.trim().length <= 1 || (!!normalizedName && normalizedPhone.endsWith(normalizedName));
}

function detectCourseOption(message: string): AdmissionCourseOption | null {
  const trimmed = (message || "").trim();
  const exactNumber = trimmed.match(/^(?:course\s*)?(\d{1,2})$/i)?.[1];
  const courseOptionNumber = trimmed.match(/\bcourse option\s+(\d{1,2})\b/i)?.[1];
  const commaNumber = trimmed.match(/,\s*(\d{1,2})\s*$/)?.[1];
  const selectedNumber = exactNumber || courseOptionNumber || commaNumber;
  if (selectedNumber) {
    const byNumber = ADMISSION_COURSE_OPTIONS.find((option) => option.number === selectedNumber);
    if (byNumber) return byNumber;
  }

  const normalized = normalizeText(message);
  return ADMISSION_COURSE_OPTIONS.find((option) =>
    option.aliases.some((alias) => normalized.includes(normalizeText(alias)))
  ) || null;
}

function extractNameCandidate(message: string): string | null {
  const trimmed = (message || "").trim();
  const explicit = trimmed.match(/\b(?:my name is|i am|i'm|myself|name is)\s+([a-z][a-z\s.'-]{1,60})/i)?.[1];
  const candidate = explicit || trimmed.match(/^([a-z][a-z\s.'-]{1,60})\s*,\s*\d{1,2}\b/i)?.[1] || null;
  if (!candidate) return null;
  const cleaned = candidate.replace(/\b(?:and|course|interested|admission|fees?|for)\b.*$/i, "").trim();
  const normalized = normalizeText(cleaned);
  if (!normalized || ADMISSION_COURSE_OPTIONS.some((option) => option.aliases.some((alias) => normalized.includes(normalizeText(alias))))) {
    return null;
  }
  return cleaned.slice(0, 100);
}

async function resolveCourseId(admin: SupabaseAdminClient, option: AdmissionCourseOption): Promise<string | null> {
  const { data: courses } = await admin
    .from("courses")
    .select("id, name, code")
    .order("code", { ascending: true });

  const rows = (courses || []) as { id: string; name: string; code: string }[];
  const byCode = rows.find((course) =>
    option.codePrefixes.some((prefix) => (course.code || "").toUpperCase().startsWith(prefix))
  );
  if (byCode?.id) return byCode.id;

  const byName = rows.find((course) => {
    const name = normalizeText(course.name);
    return option.aliases.some((alias) => name.includes(normalizeText(alias)));
  });
  return byName?.id || null;
}

async function loadCourseName(admin: SupabaseAdminClient, courseId: string | null): Promise<string | null> {
  if (!courseId) return null;
  const { data } = await admin
    .from("courses")
    .select("name, code")
    .eq("id", courseId)
    .maybeSingle();
  const row = data as { name?: string | null; code?: string | null } | null;
  return row?.name || row?.code || null;
}

interface CourseAdmissionBrief {
  short_name: string;
  positioning: string | null;
  strongest_usp: string | null;
  best_fit_lead: string | null;
  bot_first_reply: string | null;
  proof_points: string[] | null;
  qualification_questions: string[] | null;
  careers: string[] | null;
  fee_summary: string | null;
  source_url: string | null;
  last_verified_at: string | null;
}

interface WhatsAppReplyExample {
  id: string;
  query_text: string;
  reply_text: string;
  media_url: string | null;
  course_id: string | null;
  source_channel: string | null;
  target_channels: string[] | null;
  language: string | null;
  tags: string[] | null;
  quality_score: number | null;
  score: number | null;
}

function formatList(label: string, values: string[] | null | undefined): string {
  const filtered = (values || []).map((value) => value.trim()).filter(Boolean);
  return filtered.length ? `${label}: ${filtered.join("; ")}` : "";
}

function formatCourseAdmissionBrief(brief: CourseAdmissionBrief | null): string {
  if (!brief) return "";
  return [
    `Verified course brief: ${brief.short_name}`,
    brief.positioning ? `Positioning: ${brief.positioning}` : "",
    brief.strongest_usp ? `Strongest USP: ${brief.strongest_usp}` : "",
    brief.best_fit_lead ? `Best-fit lead: ${brief.best_fit_lead}` : "",
    brief.bot_first_reply ? `Bot first reply angle: ${brief.bot_first_reply}` : "",
    formatList("Proof points", brief.proof_points),
    formatList("Qualification questions", brief.qualification_questions),
    formatList("Careers", brief.careers),
    brief.fee_summary ? `Fee summary: ${brief.fee_summary}` : "",
    brief.source_url ? `Source: ${brief.source_url}` : "",
    brief.last_verified_at ? `Last verified: ${brief.last_verified_at}` : "",
  ].filter(Boolean).join("\n");
}

async function loadCourseAdmissionBrief(
  admin: SupabaseAdminClient,
  courseId: string | null,
  courseName: string | null,
): Promise<string> {
  let brief: CourseAdmissionBrief | null = null;

  if (courseId) {
    const { data } = await admin
      .from("course_admission_briefs")
      .select("short_name,positioning,strongest_usp,best_fit_lead,bot_first_reply,proof_points,qualification_questions,careers,fee_summary,source_url,last_verified_at")
      .eq("course_id", courseId)
      .maybeSingle();
    brief = data as CourseAdmissionBrief | null;
  }

  if (!brief && courseName) {
    const { data } = await admin
      .from("course_admission_briefs")
      .select("short_name,positioning,strongest_usp,best_fit_lead,bot_first_reply,proof_points,qualification_questions,careers,fee_summary,source_url,last_verified_at")
      .ilike("short_name", `%${courseName}%`)
      .limit(1)
      .maybeSingle();
    brief = data as CourseAdmissionBrief | null;
  }

  return formatCourseAdmissionBrief(brief);
}

function formatReplyExample(example: WhatsAppReplyExample, index: number): string {
  const lines = [
    `Example ${index + 1}:`,
    `Lead asked: ${example.query_text}`,
    `Counsellor replied: ${example.reply_text}`,
  ];
  if (example.media_url) lines.push(`Reference media: ${example.media_url}`);
  return lines.join("\n");
}

async function loadReplyExamplesContext(
  admin: SupabaseAdminClient,
  query: string,
  courseId: string | null,
): Promise<string> {
  if (!query || query.trim().length < 3) return "";
  try {
    const rpc = admin.rpc as (
      fn: string,
      args: Record<string, unknown>,
    ) => PromiseLike<{ data: unknown; error: { message?: string } | null }>;
    const { data, error } = await rpc("match_admissions_ai_reply_examples", {
      p_query: query,
      p_course_id: courseId,
      p_target_channel: "whatsapp",
      p_limit: 3,
    });
    if (error) {
      console.warn("Reply example lookup failed:", error.message);
      return "";
    }
    const examples = ((data || []) as WhatsAppReplyExample[])
      .filter((example) => (example.score ?? 0) >= 0.15)
      .slice(0, 3);
    return examples.length ? examples.map(formatReplyExample).join("\n\n") : "";
  } catch (err) {
    console.warn("Reply example lookup error:", err instanceof Error ? err.message : String(err));
    return "";
  }
}

async function loadGoldenAnswersContext(
  admin: SupabaseAdminClient,
  query: string,
  _courseId: string | null,
): Promise<string> {
  if (!query || query.trim().length < 3) return "";
  try {
    const searchTerms = query
      .split(/\s+/)
      .filter((w) => w.length > 2)
      .slice(0, 6)
      .join(" & ");
    if (!searchTerms) return "";

    const { data } = await admin
      .from("admissions_ai_reply_examples")
      .select("query_text, reply_text, media_url")
      .eq("status", "active")
      .gte("quality_score", 0.85)
      .or("tags.cs.{golden_answer},tags.cs.{knowledge_gap_answer},tags.cs.{admin_verified}")
      .textSearch("query_text", searchTerms, { type: "plain" })
      .limit(2);

    if (!data?.length) return "";
    return (data as { query_text: string; reply_text: string; media_url: string | null }[])
      .map((g, i) => {
        const lines = [`Admin-verified answer ${i + 1}:`, `Q: ${g.query_text}`, `A: ${g.reply_text}`];
        if (g.media_url) lines.push(`Reference media: ${g.media_url}`);
        return lines.join("\n");
      })
      .join("\n\n");
  } catch (err) {
    console.warn("Golden answers lookup error:", err instanceof Error ? err.message : String(err));
    return "";
  }
}

const TOPIC_KEYWORDS: Record<string, string[]> = {
  fees: ["fee", "fees", "cost", "price", "kitni", "paisa", "payment", "scholarship", "loan", "emi"],
  hostel: ["hostel", "accommodation", "room", "boarding", "stay", "pg"],
  eligibility: ["eligibility", "eligible", "qualification", "marks", "percentage", "cutoff", "entrance", "exam"],
  placement: ["placement", "job", "package", "salary", "lpa", "recruiter", "company", "career"],
  campus: ["campus", "location", "address", "facility", "lab", "library", "gym", "transport"],
  admission: ["admission", "apply", "application", "seat", "deadline", "last date", "form"],
  documents: ["document", "documents", "certificate", "marksheet", "photo", "aadhar", "id proof"],
};

function buildTopicContext(
  recentMessages: { direction: string; content: string }[] | null,
  courseInterest: string | null,
): string {
  if (!recentMessages?.length) return "";
  const topics: string[] = [];
  let lastCourse: string | null = null;

  for (const msg of recentMessages) {
    const text = (msg.content || "").toLowerCase();
    for (const opt of ADMISSION_COURSE_OPTIONS) {
      if (opt.aliases.some((a) => text.includes(a))) {
        lastCourse = opt.label;
        break;
      }
    }
    for (const [topic, keywords] of Object.entries(TOPIC_KEYWORDS)) {
      if (keywords.some((kw) => text.includes(kw)) && !topics.includes(topic)) {
        topics.push(topic);
      }
    }
  }

  const parts: string[] = [];
  if (lastCourse || courseInterest) parts.push(`course: ${lastCourse || courseInterest}`);
  if (topics.length) parts.push(`topics discussed: ${topics.join(", ")}`);
  return parts.length ? `[Conversation context: ${parts.join("; ")}]` : "";
}

const COURSE_MENU = ADMISSION_COURSE_OPTIONS
  .map((option) => `${option.number}. ${option.label}`)
  .join("\n");

function buildSystemPrompt(
  hasName: boolean,
  hasCourse: boolean,
  courseBriefContext: string,
  replyExamplesContext: string,
  verifiedAdmissionsContext: string,
  goldenAnswersContext: string,
  leadStage: string | null,
): string {
  const introInstructions = `\n\nLEAD ENRICHMENT:
${!hasName ? "The student's name is not yet known. If they mention their name, extract it." : ""}
${!hasCourse ? `The student's course interest is not yet known. Ask them to choose from this numbered list and tell them they can reply like "Priya, 3":\n${COURSE_MENU}` : ""}
CRITICAL RULE: If the user's message mentions or asks about a specific course (like "BPT", "MBA", "nursing", "BCA", etc.), IMMEDIATELY answer their question about that course using the knowledge base. Do NOT ask them which course they are interested in — they just told you. Extract the course name and provide the information.
If Lead info includes a Course interest, use that course for follow-up questions about fees, yearly cost, eligibility, duration, campus, application steps, or pronouns like "it" / "this". Do NOT ask which course again when Course interest is present.
If the user replies with a course option number, treat it as that course selection from the numbered list.
Only ask for missing info (name or course) if the user's message does NOT contain any course reference or name. Never ask for something the user already provided in their message.
When you detect name or course in the user's message, include at the END of your response:
{"extracted_name": "...", "extracted_course": "..."}
Only include fields that are newly detected. If the user said "bpt", include extracted_course. If they said "I'm Priya", include extracted_name.`;

  const classificationInstructions = `

QUERY CLASSIFICATION:
At the very end of every response, include this JSON:
{"query_type": "admission" | "non_admission", "confidence": 0.0 to 1.0}
- "admission": questions about courses, fees, eligibility, placements, campus, hostel, scholarships, application process
- "non_admission": general queries, complaints, feedback, job inquiries, vendor queries, alumni requests
- confidence: 1.0 = answered from knowledge base, 0.5 = inferred, 0.0 = couldn't answer

COURSE NOT OFFERED — CRITICAL RULE:
If a student asks about a course that NIMT does NOT offer (e.g. MBBS, BDS, Engineering B.Tech/BE, Architecture, Agriculture, Veterinary, Film, Fashion, Hotel Management, Mass Communication, CA, CS, etc.):
1. Clearly state that we do not currently offer that specific course.
2. Suggest 2-3 relevant NIMT courses that might interest them based on their background or goals.
3. Ask if any of those alternatives interest them.
NEVER pretend NIMT offers a course it does not.

DISINTEREST / DNC DETECTION:
If the student's message clearly indicates they are no longer interested in admission (e.g. "not interested", "don't call me", "stop messaging", "I've already joined elsewhere", "nahi chahiye", "mat contact karo", "already admitted somewhere else"):
- Include at the END of your response (as a separate JSON line):
  {"action": "mark_not_interested"}
If they want to be completely removed from contact (e.g. "remove me", "block", "stop", "DNC", "do not contact"):
  {"action": "mark_dnc"}
Only include the action JSON when you are highly confident about the student's intent.

COUNSELLOR HANDOFF DETECTION:
If you previously offered to arrange a call / connect the student with a counsellor, and the student replies affirmatively (e.g. "yes", "yess", "sure", "ok", "haan", "ji", "please", "yes please", "connect me", "call me", "I want to talk", "mujhe baat karni hai"), include:
  {"action": "request_counsellor"}
When you detect this action, write a SHORT acknowledgement (1-2 sentences) like "Great! Let me connect you with our admissions counsellor." — the system will automatically replace this with a personalised message containing the counsellor's name. Do NOT fabricate a counsellor name yourself.
Also emit this action if the student proactively asks to speak to a person / counsellor / human, even without a prior offer.`;

  const stageInstructions = leadStage ? `

LEAD STAGE BEHAVIOR (current stage: ${leadStage}):
- new_lead / enquiry: Be welcoming and warm. Share 1-2 USPs about the course if known. Don't overwhelm with details — keep it conversational.
- interested / qualified: They already know about NIMT. Answer their specific questions thoroughly. Proactively share proof points and placement stats.
- campus_visit_scheduled / visited: They're warm — reinforce their decision. Share next steps (application link, documents needed). Create gentle urgency ("admissions are filling up").
- applied / admitted: Congratulate them! Help with fee payment, hostel booking, documents. Be operational, not salesy.
- Follow the behavior for the current stage. If stage is unknown, default to "new_lead" behavior.` : "";

  return `You are the NIMT Admissions Assistant — a helpful, warm, and knowledgeable guide for students and parents exploring admissions at NIMT Educational Institutions (National Institute of Management and Technology).

PERSONALITY:
- Write like a friendly senior student who genuinely wants to help — not like a corporate brochure.
- Be warm, encouraging, and practical. Show genuine interest in the student's goals.
- Vary your openings — do NOT start every reply with "Thank you for your interest" or "Thank you for reaching out".
- Avoid corporate jargon like "we would like to inform you", "we are pleased to", "kindly note that". Be natural.
- Use the student's name when you know it. It makes the conversation personal.
- One or two emojis per message is fine (not every message). Don't overdo it.

TONE EXAMPLES (robotic → human):
❌ "Thank you for your interest in NIMT. We would like to inform you that B.Sc Nursing is a 4-year programme."
✅ "B.Sc Nursing at NIMT is a 4-year programme with a 6-month paid internship at the end — students actually earn ₹10,000/month during that internship! 🎓"

❌ "Kindly note that the fee for BPT is ₹92,000 per year."
✅ "BPT fees are ₹92,000/year — and we have merit scholarships that can bring that down. Want me to share the details?"

❌ "For further queries, please contact our helpline."
✅ "Feel free to ask anything else here, or call us at +91 9555192192 if you'd like to chat!"

FORMATTING (WhatsApp):
- Never use markdown links like [text](url). Just paste the plain URL directly.
- Use *bold* with single asterisks for emphasis (WhatsApp format).
- Keep paragraphs to 2-3 lines max. Use line breaks liberally. No HTML tags.
- Max 3-4 short paragraphs per message. This is WhatsApp, not email.

LANGUAGE RULES (follow strictly):
- If the user writes in English → reply in English. This is the default.
- If the user writes in Hindi (Devanagari script) → reply in Hindi.
- If the user writes in Hinglish (Hindi words in English script) → reply in Hinglish.
- When in doubt, lean towards English. English is the default language.
- Match the user's language from their CURRENT message, not previous ones.
${stageInstructions}

End with a natural call to action — an offer to help further, a relevant link, or mention that a counsellor can call them.

UNCERTAINTY RULES:
- If you are NOT confident you have the correct answer (e.g., the question is about a specific policy, date, or detail not in your knowledge base), say something like "Let me check on this — I'll have our admissions team get back to you. You can also call us at +91 9555192192."
- NEVER guess or fabricate specific numbers for fees, deadlines, eligibility cutoffs, or scholarship amounts.
- When you deflect to the counsellor, set confidence to 0.3 or lower.

FEE ANSWER RULES (strict):
- If the user asks about fee, fees, fee structure, cost, total fee, yearly fee, scholarship, loan, "kitni fees", or similar, answer with the fee facts available in the knowledge base instead of only saying "contact admissions".
- If the course is known from lead context or the current message, include that course's first-year fee, campus if known, and mention that full year-wise programme fees are published here: ${FEE_STRUCTURE_URL}
- If the course is unknown, give a compact sample list of popular first-year fees, share ${FEE_STRUCTURE_URL}, and ask which course/campus they want so you can send the exact breakdown.
- Mention scholarships/loan support when relevant, but do not promise a waiver amount unless it is in the verified brief or knowledge base.
- Never invent fee amounts. If a requested course fee is absent from the knowledge base, share ${FEE_STRUCTURE_URL} and say a counsellor will confirm the exact breakup.

Do NOT make up information not present in the knowledge base.${introInstructions}${classificationInstructions}
${goldenAnswersContext ? `\n\nADMIN-VERIFIED ANSWERS (HIGHEST PRIORITY):\nThese answers were provided by admins as the correct response. When a student asks a similar question, use these answers as your primary source — they override the general knowledge base and counsellor examples.\n${goldenAnswersContext}` : ""}
${verifiedAdmissionsContext ? `\n\n${verifiedAdmissionsContext}` : ""}
${courseBriefContext ? `\n\nCOURSE-SPECIFIC VERIFIED BRIEF:\n${courseBriefContext}\n\nCOURSE BRIEF USAGE:\n- First question about a course → weave the strongest USP into your answer naturally, don't list it.\n- "Why NIMT" or comparison questions → cite proof points as evidence.\n- First-time enquiry → use the bot_first_reply angle.\n- After answering → ask ONE relevant qualification question to qualify the lead.` : ""}
${replyExamplesContext ? `\n\nORGANISATION REPLY EXAMPLES:\nUse these as examples of how NIMT counsellors answer similar WhatsApp queries. Do not copy personal details, phone numbers, emails, or promises from examples. Verified course brief and knowledge base override examples if they conflict.\n${replyExamplesContext}` : ""}

KNOWLEDGE BASE:
${KNOWLEDGE_BASE}`;
}

// ─── Main Handler ────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { phone, message, lead_name, lead_stage, course_interest, recent_messages, business_phone_number_id, provider, business_number } = await req.json();
    // 'meta' (default, direct Graph API) or 'plivo' (BSP coexistence number).
    const sendProvider: "meta" | "plivo" = provider === "plivo" ? "plivo" : "meta";
    // Channel key for the per-conversation AI/human guard: the Plivo number's
    // digits for the plivo path, else the Meta phone_number_id.
    const channelKey = conversationBusinessKey(
      sendProvider,
      typeof business_phone_number_id === "string" ? business_phone_number_id : null,
      typeof business_number === "string" ? business_number : null,
    );

    if (!phone || !message) {
      return new Response(JSON.stringify({ error: "phone and message required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization") || req.headers.get("authorization") || "";
    if (authHeader !== `Bearer ${serviceRoleKey}`) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(supabaseUrl, serviceRoleKey);
    const googleApiKey = Deno.env.get("GEMINI_API_KEY") || Deno.env.get("GOOGLE_AI_API_KEY")!;
    const normalizedPhone = digits(phone);

    // Check if a counsellor manually replied in the last 30 minutes — skip AI if so
    // Auto-replies are tagged template_key="auto_reply"; AI replies tagged "ai_auto_reply"
    // Only untagged outbound messages are genuine counsellor replies
    const thirtyMinsAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
    const { data: recentCounsellorReply } = await admin
      .from("whatsapp_messages")
      .select("id")
      .eq("phone", phone)
      .eq("direction", "outbound")
      .gte("created_at", thirtyMinsAgo)
      .is("template_key", null)
      .limit(1);

    if (recentCounsellorReply && recentCounsellorReply.length > 0) {
      return new Response(JSON.stringify({ skipped: true, reason: "counsellor_replied_recently" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Per-conversation AI/human guard ──────────────────────────────────────
    // When a counsellor has flipped this chat to 'human' (from the inbox), the
    // bot stays silent and humans handle it. Missing row → defaults to 'ai', so
    // the existing Meta number is unaffected unless a row is explicitly created.
    if (channelKey) {
      const { data: stateRow } = await admin
        .from("whatsapp_conversation_state")
        .select("mode,state")
        .eq("phone", normalizedPhone)
        .eq("business_number", channelKey)
        .maybeSingle();
      if (stateRow?.mode === "human" || stateRow?.mode === "paused" || stateRow?.mode === "closed") {
        await logWhatsAppAutomationEvent(admin, {
          phone,
          businessNumber: channelKey,
          provider: sendProvider,
          eventType: "human_mode_skip",
          decision: "skip_ai_reply",
          reason: `conversation_${stateRow.mode}`,
        });
        return new Response(JSON.stringify({ skipped: true, reason: `conversation_${stateRow.mode}` }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const { data: modeRow } = await admin
        .from("whatsapp_ai_mode")
        .select("mode")
        .eq("phone", normalizedPhone)
        .eq("business_number", channelKey)
        .maybeSingle();
      if (modeRow?.mode === "human") {
        await logWhatsAppAutomationEvent(admin, {
          phone,
          businessNumber: channelKey,
          provider: sendProvider,
          eventType: "human_mode_skip",
          decision: "skip_ai_reply",
          reason: "human_mode",
        });
        return new Response(JSON.stringify({ skipped: true, reason: "human_mode" }), {
          status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // ── Find or create lead ──────────────────────────────────────────────────
    const { data: existingLeads } = await admin
      .from("leads")
      .select("id, name, course_id, person_role, counsellor_id")
      .or(`phone.eq.${normalizedPhone},phone.eq.${normalizedPhone.replace(/^91/, "+91")},phone.eq.+${normalizedPhone}`)
      .eq("is_mirror", false)
      .limit(1);

    const existingLead = existingLeads?.[0] || null;
    let leadId = existingLead?.id || null;
    let existingCourseId = existingLead?.course_id || null;
    let existingCourseName = await loadCourseName(admin, existingCourseId);
    let hasName = !isPlaceholderLeadName(existingLead?.name, normalizedPhone);
    let leadNameForPrompt = lead_name || (hasName ? existingLead?.name || null : null);
    let courseInterestForPrompt = course_interest || existingCourseName || null;
    let hasCourse = !!(existingCourseId || courseInterestForPrompt);

    // ── Short-circuit: don't pitch admissions to job applicants / vendors ────
    // Send a single templated reply instead and let HR / procurement take over.
    if (existingLead && (existingLead.person_role === "job_applicant" || existingLead.person_role === "vendor")) {
      const role = existingLead.person_role;
      const reply = role === "job_applicant"
        ? "Thanks for writing to NIMT. You've been forwarded to our HR team — they will get in touch about openings shortly. For urgent queries email careers@nimt.ac.in."
        : "Thanks for your message. You've been forwarded to our procurement team. For business enquiries please email procurement@nimt.ac.in with your company profile.";
      try {
        const sendResult = await sendWhatsAppText(admin, {
          provider: sendProvider,
          route: sendProvider === "plivo" ? "plivo_admissions" : "reply",
          businessPhoneNumberId: typeof business_phone_number_id === "string" ? business_phone_number_id : null,
          businessNumber: channelKey,
          requireManualReply: true,
        }, phone, reply);

        if (sendResult.ok) {
          await recordOutboundConversationAction(admin, {
            kind: "handoff",
            phone,
            leadId,
            content: reply,
            messageType: "text",
            templateKey: role === "job_applicant" ? "hr_handoff" : "procurement_handoff",
            status: "sent",
            sendResult,
            outboundKind: "system_notification",
            expectedReplyType: "general",
            responsePolicy: "human",
            metadata: { role },
            conversationState: {
              mode: "human",
              state: role === "job_applicant" ? "job_handoff" : "vendor_handoff",
              ownerUserId: existingLead?.counsellor_id || null,
              escalationRole: role === "job_applicant" ? "hr" : "procurement",
              handoffReason: `classified_${role}`,
              priority: "normal",
              lastIntent: role,
            },
          });
        } else {
          console.error("Job/vendor handoff send failed:", sendResult.raw || sendResult.error);
        }
      } catch (e) {
        console.error("Job/vendor handoff reply error:", e);
      }
      return new Response(JSON.stringify({ skipped: true, reason: `person_role=${role}` }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Auto-create lead if doesn't exist. `leads.name` is NOT NULL, so we
    // fall back to the phone number when the candidate hasn't shared
    // their name yet — the AI prompt asks for it on the next turn and
    // updates the lead when they reply with it.
    if (!leadId) {
      const phoneForLead = normalizedPhone.length === 10 ? `+91${normalizedPhone}` : `+${normalizedPhone}`;
      const { data: newLead, error: leadInsertErr } = await admin
        .from("leads")
        .insert({
          phone: phoneForLead,
          source: "whatsapp",
          stage: "new_lead",
          name: lead_name || phoneForLead,
        })
        .select("id")
        .single();
      if (leadInsertErr) {
        console.error("Auto-create lead failed:", leadInsertErr.message);
      }
      leadId = newLead?.id || null;
      console.log("Auto-created lead from WhatsApp:", leadId);
    }

    const deterministicName = !hasName ? extractNameCandidate(message) : null;
    if (leadId && deterministicName) {
      await admin.from("leads").update({ name: deterministicName }).eq("id", leadId);
      hasName = true;
      leadNameForPrompt = deterministicName;
    }

    const selectedCourseOption = !hasCourse ? detectCourseOption(message) : null;
    if (leadId && selectedCourseOption) {
      const courseId = await resolveCourseId(admin, selectedCourseOption);
      courseInterestForPrompt = selectedCourseOption.label;
      hasCourse = true;

      if (courseId) {
        await admin.from("leads").update({ course_id: courseId }).eq("id", leadId);
        existingCourseId = courseId;
        existingCourseName = await loadCourseName(admin, courseId);
        courseInterestForPrompt = existingCourseName || courseInterestForPrompt;
      }

      await admin.from("lead_notes").insert({
        lead_id: leadId,
        content: `Course interest (from WhatsApp): ${selectedCourseOption.label}`,
        user_id: null,
      });
    }

    // Build conversation context (12 messages for better topic continuity)
    const contextParts: { role: string; parts: { text: string }[] }[] = [];
    if (recent_messages && recent_messages.length > 0) {
      for (const msg of recent_messages.slice(-12)) {
        contextParts.push({
          role: msg.direction === "inbound" ? "user" : "model",
          parts: [{ text: msg.content || "[media]" }],
        });
      }
    }
    const topicContext = buildTopicContext(recent_messages, courseInterestForPrompt);
    const leadContext = leadNameForPrompt || courseInterestForPrompt || existingCourseId
      ? `[Lead info: Name=${leadNameForPrompt || "not specified"}, Stage=${lead_stage || "unknown"}, Course interest=${courseInterestForPrompt || (existingCourseId ? "selected in CRM" : "not specified")}]`
      : "";
    const contextPrefix = [topicContext, leadContext].filter(Boolean).join("\n");
    contextParts.push({ role: "user", parts: [{ text: contextPrefix ? `${contextPrefix}\n\n${message}` : message }] });

    const [courseBriefContext, replyExamplesContext, verifiedAdmissionsContext, goldenAnswersContext] = await Promise.all([
      loadCourseAdmissionBrief(admin, existingCourseId, courseInterestForPrompt),
      loadReplyExamplesContext(admin, message, existingCourseId),
      loadVerifiedAdmissionsContext(admin, existingCourseId, courseInterestForPrompt),
      loadGoldenAnswersContext(admin, message, existingCourseId),
    ]);

    // Call Gemini with dynamic system prompt
    const systemPrompt = buildSystemPrompt(
      hasName,
      hasCourse,
      courseBriefContext,
      replyExamplesContext,
      verifiedAdmissionsContext,
      goldenAnswersContext,
      lead_stage,
    );
    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${googleApiKey}`;
    const geminiBody = JSON.stringify({
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents: contextParts,
      generationConfig: { temperature: 0.55, maxOutputTokens: 1000, topP: 0.9 },
    });
    const geminiHeaders = { "Content-Type": "application/json" };

    let geminiRes = await fetch(geminiUrl, { method: "POST", headers: geminiHeaders, body: geminiBody });

    // Retry once on transient errors (503 capacity, 429 rate limit)
    if (!geminiRes.ok && (geminiRes.status === 503 || geminiRes.status === 429)) {
      console.warn(`Gemini ${geminiRes.status}, retrying in 2s...`);
      await new Promise((r) => setTimeout(r, 2000));
      geminiRes = await fetch(geminiUrl, { method: "POST", headers: geminiHeaders, body: geminiBody });
    }

    const aiFailureChannel = {
      phone,
      leadId,
      provider: sendProvider,
      businessPhoneNumberId: typeof business_phone_number_id === "string" ? business_phone_number_id : null,
      businessNumber: channelKey,
    };

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      console.error("Gemini error:", errText);
      await recordAiFailureBubble(admin, {
        ...aiFailureChannel,
        reason: `AI generation failed (${geminiRes.status})`,
        detail: errText.slice(0, 1000),
      });
      await logWhatsAppAutomationEvent(admin, {
        phone,
        businessNumber: channelKey,
        provider: sendProvider,
        leadId,
        eventType: "send_failed",
        decision: "ai_generation_failed",
        reason: JSON.stringify({ error: "AI generation failed", detail: errText.slice(0, 1000) }),
      });
      return new Response(JSON.stringify({ error: "AI generation failed", detail: errText }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const geminiData = await geminiRes.json();
    const rawReply = geminiData?.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!rawReply) {
      await recordAiFailureBubble(admin, {
        ...aiFailureChannel,
        reason: "AI returned an empty response",
      });
      return new Response(JSON.stringify({ error: "empty AI response" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Parse all JSON blocks from AI response ────────────────────────────
    // Match any JSON object in the response (extracted info, classification, action, etc.)
    const jsonBlocks = rawReply.match(/\{[^{}]*"(?:extracted_name|extracted_course|query_type|confidence|action)"[^{}]*\}/g) || [];

    let extractedName: string | null = null;
    let extractedCourse: string | null = null;
    let queryType = "admission";
    let confidence = 0.5;
    let botAction: string | null = null;

    for (const block of jsonBlocks) {
      try {
        const parsed = JSON.parse(block);
        if (parsed.extracted_name) extractedName = parsed.extracted_name.trim().slice(0, 100);
        if (parsed.extracted_course) extractedCourse = parsed.extracted_course.trim().slice(0, 100);
        if (parsed.query_type) queryType = parsed.query_type;
        if (parsed.confidence !== undefined) confidence = parsed.confidence;
        if (parsed.action) botAction = parsed.action;
      } catch { /* ignore parse errors */ }
    }

    // Enrich lead with extracted info
    if (leadId) {
      if (extractedName) {
        await admin.from("leads").update({ name: extractedName }).eq("id", leadId);
        console.log("Enriched lead name:", leadId, extractedName);
      }
      if (extractedCourse) {
        const extractedCourseOption = detectCourseOption(extractedCourse);
        if (extractedCourseOption) {
          const courseId = await resolveCourseId(admin, extractedCourseOption);
          if (courseId) {
            await admin.from("leads").update({ course_id: courseId }).eq("id", leadId);
          }
        }
        await admin.from("lead_notes").insert({
          lead_id: leadId,
          content: `Course interest (from WhatsApp): ${extractedCourse}`,
          user_id: null,
        }).then(() => console.log("Logged course interest:", extractedCourse));
      }
    }

    // Clean AI reply — remove ALL JSON blocks
    const aiReply = rawReply
      .replace(/\{[^{}]*"(?:extracted_name|extracted_course|query_type|confidence|action)"[^{}]*\}/g, "")
      .trim();

    // ── Act on bot-detected signals ──────────────────────────────────────────
    let finalReply = aiReply;
    let counsellorHandoff = false;
    let assignedCounsellorId: string | null = existingLead?.counsellor_id || null;
    let assignedCounsellorName: string | null = null;
    let assignedCounsellorPhone: string | null = null;
    let assignedCounsellorUserId: string | null = null;

    if (leadId && botAction === "request_counsellor") {
      // ── Counsellor handoff: assign, personalise reply, notify counsellor ──
      counsellorHandoff = true;

      if (!assignedCounsellorId) {
        try {
          const { data: newCounsellorId } = await admin.rpc("fn_intake_round_robin_assign", { _lead_id: leadId });
          if (newCounsellorId) {
            assignedCounsellorId = newCounsellorId as string;
            console.log(`Counsellor handoff: assigned lead ${leadId} → ${assignedCounsellorId}`);
          }
        } catch (e) {
          console.error("Counsellor handoff assignment failed:", (e as Error).message);
        }
      }

      if (assignedCounsellorId) {
        const { data: counsellorProfile } = await admin
          .from("profiles")
          .select("user_id, display_name, phone")
          .eq("id", assignedCounsellorId)
          .maybeSingle();
        assignedCounsellorName = counsellorProfile?.display_name || null;
        assignedCounsellorPhone = counsellorProfile?.phone || null;
        assignedCounsellorUserId = counsellorProfile?.user_id || null;
      }

      const studentName = leadNameForPrompt || "there";
      if (assignedCounsellorName) {
        finalReply = `Great news, ${studentName}! Your enquiry has been assigned to *${assignedCounsellorName}*, our admissions counsellor. They will contact you shortly to help you with everything you need.\n\nIf you have any quick questions in the meantime, feel free to ask here or call our helpline: +91 9555192192`;
      } else {
        finalReply = `Thank you, ${studentName}! Your request has been noted. An admissions counsellor will contact you shortly to assist you.\n\nIn the meantime, feel free to ask any questions here or call our helpline: +91 9555192192`;
      }

      // Notify counsellor via in-app notification
      if (assignedCounsellorUserId) {
        const summaryParts: string[] = [];
        if (recent_messages && recent_messages.length > 0) {
          for (const msg of recent_messages.slice(-4)) {
            const prefix = msg.direction === "inbound" ? "Student" : "Bot";
            const snippet = (msg.content || "").substring(0, 120);
            summaryParts.push(`${prefix}: ${snippet}`);
          }
        }
        summaryParts.push(`Student: ${message.substring(0, 120)}`);
        const conversationSummary = summaryParts.join("\n");

        await admin.from("notifications").insert({
          user_id: assignedCounsellorUserId,
          type: "general",
          title: `New WhatsApp lead: ${leadNameForPrompt || phone}${courseInterestForPrompt ? ` — ${courseInterestForPrompt}` : ""}`,
          body: `Student wants to speak to a counsellor. Please call them immediately.\n\nConversation summary:\n${conversationSummary}`,
          link: `/admissions/${leadId}`,
          lead_id: leadId,
        });
      }

      // Send WhatsApp to counsellor with conversation summary
      if (assignedCounsellorPhone) {
        const counsellorDigits = digits(assignedCounsellorPhone);
        const summaryLines: string[] = [];
        if (recent_messages && recent_messages.length > 0) {
          for (const msg of recent_messages.slice(-4)) {
            const prefix = msg.direction === "inbound" ? "👤" : "🤖";
            summaryLines.push(`${prefix} ${(msg.content || "").substring(0, 150)}`);
          }
        }
        summaryLines.push(`👤 ${message.substring(0, 150)}`);

        const counsellorMsg = [
          `🔔 *New Lead Assigned*`,
          ``,
          `*Student:* ${leadNameForPrompt || phone}`,
          courseInterestForPrompt ? `*Course:* ${courseInterestForPrompt}` : null,
          `*Phone:* +${normalizedPhone}`,
          ``,
          `*Conversation:*`,
          ...summaryLines,
          ``,
          `Please call the student now to assist them.`,
        ].filter(Boolean).join("\n");

        try {
          await sendWhatsAppText(admin, {
            provider: sendProvider,
            route: sendProvider === "plivo" ? "plivo_admissions" : "reply",
            businessPhoneNumberId: typeof business_phone_number_id === "string" ? business_phone_number_id : null,
            businessNumber: channelKey,
          }, counsellorDigits, counsellorMsg);
          console.log(`Counsellor WhatsApp notification sent to ${counsellorDigits}`);
        } catch (e) {
          console.error("Counsellor WhatsApp notification failed:", (e as Error).message);
        }
      }

      // Flip AI mode to human so subsequent messages go to the counsellor
      if (channelKey) {
        await admin
          .from("whatsapp_ai_mode")
          .upsert(
            {
              phone: normalizedPhone,
              business_number: channelKey,
              mode: "human",
              updated_at: new Date().toISOString(),
            },
            { onConflict: "phone,business_number" },
          );
      }
    } else if (leadId && botAction === "mark_not_interested") {
      await applyLeadTransition(admin, {
        leadId,
        command: "classifyNotInterested",
        activityType: "whatsapp",
        description: "Bot auto-marked Not Interested from WhatsApp reply",
      });
      console.log("Bot auto-marked not_interested:", leadId);
    } else if (leadId && botAction === "mark_dnc") {
      await applyLeadTransition(admin, {
        leadId,
        command: "markDnc",
        activityType: "whatsapp",
        description: "Bot auto-marked DNC from WhatsApp reply",
      });
      console.log("Bot auto-marked dnc:", leadId);
    }

    // ── Route non-admission queries to profile_queries ──────────────────────
    if (queryType === "non_admission" && leadId) {
      await admin.from("profile_queries").insert({
        phone: normalizedPhone,
        lead_id: leadId,
        query_text: message,
        ai_response: aiReply,
        status: "pending",
      });
    }

    // ── Log knowledge gap if low confidence ─────────────────────────────────
    if (confidence < 0.6 && queryType === "admission") {
      await admin.from("knowledge_gaps").insert({
        query_text: message,
        context: { course: course_interest || "unknown", lead_id: leadId },
        source: "whatsapp",
        confidence_score: confidence,
        status: "pending",
      });

      // Auto-escalate very low confidence to counsellor/admission_head
      if (confidence < 0.4 && leadId) {
        const escalateUserId = assignedCounsellorUserId || existingLead?.counsellor_id || null;
        if (escalateUserId) {
          await admin.from("notifications").insert({
            user_id: escalateUserId,
            type: "general",
            title: `Low-confidence AI reply: ${leadNameForPrompt || phone}`,
            body: `The AI wasn't confident answering this question. Please follow up.\n\nStudent asked: "${message.substring(0, 150)}"`,
            link: `/admissions/${leadId}`,
            lead_id: leadId,
          });
        }
      }
    }

    // ── Send via WhatsApp API ───────────────────────────────────────────────
    const sendResult = await sendWhatsAppText(admin, {
      provider: sendProvider,
      route: sendProvider === "plivo" ? "plivo_admissions" : "reply",
      businessPhoneNumberId: typeof business_phone_number_id === "string" ? business_phone_number_id : null,
      businessNumber: channelKey,
      requireAi: !counsellorHandoff,
    }, phone, finalReply);

    if (!sendResult.ok) {
      console.error("WhatsApp AI send failed:", sendResult.raw || sendResult.error);
      await recordAiFailureBubble(admin, {
        ...aiFailureChannel,
        businessNumber: sendResult.businessNumber || sendResult.businessPhoneNumberId || channelKey,
        reason: sendResult.error || "WhatsApp send failed",
        detail: sendResult.raw,
        content: finalReply,
      });
      await logWhatsAppAutomationEvent(admin, {
        phone,
        businessNumber: sendResult.businessNumber || sendResult.businessPhoneNumberId || channelKey,
        provider: sendResult.provider,
        leadId,
        eventType: "send_failed",
        decision: "ai_reply_failed",
        reason: sendResult.error,
        metadata: { status: sendResult.status, raw: sendResult.raw },
      });
      return new Response(JSON.stringify({ error: sendResult.error || "WhatsApp send failed", detail: sendResult.raw }), {
        status: sendResult.status >= 400 ? sendResult.status : 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const agUiTrace = createWhatsAppAgUiTrace({
      phone,
      businessNumber: sendResult.businessNumber || sendResult.businessPhoneNumberId || channelKey,
      provider: sendResult.provider,
      leadId,
      userMessage: message,
      assistantMessage: finalReply,
      queryType,
      confidence,
      action: botAction,
    });

    await recordOutboundConversationAction(admin, {
      kind: counsellorHandoff ? "handoff" : "aiReply",
      phone,
      leadId,
      content: finalReply,
      messageType: "text",
      templateKey: counsellorHandoff ? "counsellor_handoff" : "ai_auto_reply",
      status: "sent",
      sendResult,
      outboundKind: counsellorHandoff ? "system_notification" : "ai_reply",
      expectedReplyType: counsellorHandoff ? "general" : "general",
      responsePolicy: counsellorHandoff ? "human" : "engine",
      automationEvent: {
        eventType: counsellorHandoff ? "handoff_created" : "ai_reply_sent",
        decision: botAction,
        reason: counsellorHandoff ? "student_requested_counsellor" : queryType,
        confidence,
        metadata: {
          message_id: sendResult.messageId,
          copilotkit: agUiTrace,
          ...(counsellorHandoff ? {
            assigned_counsellor_id: assignedCounsellorId,
            assigned_counsellor_name: assignedCounsellorName,
          } : {}),
        },
      },
      conversationState: counsellorHandoff
        ? {
            mode: "human",
            state: "needs_counsellor",
            ownerUserId: assignedCounsellorUserId || existingLead?.counsellor_id || null,
            escalationRole: "counsellor",
            handoffReason: "student_requested_counsellor",
            priority: "high",
            slaDueAt: new Date(Date.now() + 30 * 60_000).toISOString(),
            lastIntent: queryType,
            lastConfidence: confidence,
            lastBotAction: botAction,
          }
        : {
            mode: "ai",
            state: confidence < 0.6 ? "knowledge_gap" : "answered_by_ai",
            ownerUserId: existingLead?.counsellor_id || null,
            escalationRole: confidence < 0.6 ? "admission_head" : null,
            handoffReason: confidence < 0.6 ? "low_confidence" : null,
            priority: confidence < 0.6 ? "high" : "normal",
            lastIntent: queryType,
            lastConfidence: confidence,
            lastBotAction: botAction,
          },
    });

    return new Response(JSON.stringify({ success: true, reply: finalReply, query_type: queryType, action: botAction }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: unknown) {
    console.error("AI reply error:", err);
    const message = err instanceof Error ? err.message : "AI reply failed";
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
