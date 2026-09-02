import {
  buildTemporalContext,
  CAMPUS_INFO,
  COURSE_KNOWLEDGE,
  NIMT_OVERVIEW,
} from "../../../web-chat-server/knowledge.ts";

export { buildTemporalContext };

import { feeTermLabelLong } from "./feeTermLabels.ts";

const FEE_STRUCTURE_URL = "https://nimt.ac.in/admissions/fees/";

type SupabaseLike = {
  from: (table: string) => any;
  rpc?: (fn: string, args?: Record<string, unknown>) => any;
};

interface CourseKnowledge {
  highlights: string[];
  practicalExposure: string;
  careers: string;
  whyNimt: string;
  eligibility: string;
  entrance: string;
  duration: string;
  campus: string;
  fee?: string;
  placementHighlights?: string;
}

interface CourseRow {
  id: string;
  name: string | null;
  code: string | null;
  duration_years: number | null;
  type: string | null;
  course_summary?: string | null;
  curriculum_url?: string | null;
}

interface EligibilityRow {
  min_age: number | null;
  max_age: number | null;
  class_12_min_marks: number | null;
  graduation_min_marks: number | null;
  sc_st_min_marks?: number | null;
  requires_graduation: boolean | null;
  entrance_exam_name: string | null;
  entrance_exam_required: boolean | null;
  subject_prerequisites: string[] | null;
  notes: string | null;
}

interface FeeStructureRow {
  id: string;
  version: string | null;
  metadata: Record<string, unknown> | null;
  session_id: string | null;
  admission_sessions?: { name?: string | null; is_active?: boolean | null } | null;
}

interface FeeItemRow {
  term: string | null;
  amount: number | string | null;
  fee_codes?: { name?: string | null; code?: string | null } | null;
}

function normalize(value: string | null | undefined): string {
  return (value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function formatMoney(value: number | string | null | undefined): string {
  const amount = Number(value || 0);
  if (!Number.isFinite(amount) || amount <= 0) return "";
  return `Rs ${amount.toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

function findKnowledgeByCourse(courseName: string | null | undefined): [string, CourseKnowledge] | null {
  const normalizedCourse = normalize(courseName);
  if (!normalizedCourse) return null;

  for (const [key, value] of Object.entries(COURSE_KNOWLEDGE as Record<string, CourseKnowledge>)) {
    const normalizedKey = normalize(key);
    if (
      normalizedCourse === normalizedKey ||
      normalizedCourse.includes(normalizedKey) ||
      normalizedKey.includes(normalizedCourse)
    ) {
      return [key, value];
    }
  }

  return null;
}

function formatEligibility(row: EligibilityRow | null, course: CourseRow | null, knowledge: CourseKnowledge | null): string {
  const parts: string[] = [];
  // courses.marketing_eligibility is deliberately NOT used: it was the field
  // that disagreed with every other surface (LLB read "10+2 with min 50%" for a
  // graduate-entry course). Curated eligibility comes from course_facts and is
  // injected above this block, marked authoritative.
  if (row?.notes) parts.push(`Eligibility rule notes: ${row.notes}`);
  if (row?.subject_prerequisites?.length) parts.push(`Subjects: ${row.subject_prerequisites.join(", ")}`);
  if (row?.class_12_min_marks) parts.push(`Class 12 minimum marks: ${row.class_12_min_marks}%`);
  if (row?.graduation_min_marks) parts.push(`Graduation minimum marks: ${row.graduation_min_marks}%`);
  if (row?.sc_st_min_marks) parts.push(`Reserved-category minimum marks: ${row.sc_st_min_marks}%`);
  if (row?.min_age) parts.push(`Minimum age: ${row.min_age}`);
  if (row?.max_age) parts.push(`Maximum age: ${row.max_age}`);
  if (row?.entrance_exam_name) {
    parts.push(`Entrance: ${row.entrance_exam_name}${row.entrance_exam_required ? " required" : ""}`);
  }
  if (!parts.length && knowledge?.eligibility) parts.push(`Knowledge file eligibility: ${knowledge.eligibility}`);
  return parts.join("; ");
}

function feeMetadataSummary(metadata: Record<string, unknown> | null | undefined): string {
  if (!metadata) return "";
  const summaries: string[] = [];

  // How long the programme actually runs and how it is billed. D.AOTT is
  // "2.5 yrs · 5 semesters" — without this Navya reads 5 collection terms off a
  // 2-year course and invents a 5-year programme.
  const planName = metadata.plan_name || metadata.display_name;
  if (typeof planName === "string" && planName.trim()) summaries.push(`Plan: ${planName.trim()}`);
  const durationLabel = metadata.duration_label;
  if (typeof durationLabel === "string" && durationLabel.trim()) {
    summaries.push(`Duration: ${durationLabel.trim()}`);
  }

  const yearWise = metadata.year_wise || metadata.yearWise || metadata.years;
  if (yearWise && typeof yearWise === "object" && !Array.isArray(yearWise)) {
    for (const [key, value] of Object.entries(yearWise as Record<string, unknown>).slice(0, 8)) {
      if (typeof value === "number" || typeof value === "string") {
        const money = formatMoney(value);
        if (money) summaries.push(`${feeTermLabelLong(key, metadata)}: ${money}`);
      }
    }
  } else {
    // The common shape is top-level per-term keys (year_1 … year_5), each an
    // object carrying { fee, label, payment_note }. This branch never existed,
    // so a structure like D.AOTT's contributed no fee summary at all.
    const perTerm = Object.keys(metadata)
      .filter((k) => /^(year|sem(?:ester)?|term|q(?:uarter)?)[_\s-]?\d+$/i.test(k))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      .slice(0, 8);
    for (const key of perTerm) {
      const entry = metadata[key];
      const fee = entry && typeof entry === "object" && !Array.isArray(entry)
        ? (entry as Record<string, unknown>).fee
        : entry;
      const money = formatMoney(fee as number | string | null);
      if (money) summaries.push(`${feeTermLabelLong(key, metadata)}: ${money}`);
    }
  }

  const total = metadata.total || metadata.total_fee || metadata.programme_total || metadata.programmeTotal;
  const formattedTotal = formatMoney(total as number | string | null);
  if (formattedTotal) summaries.push(`Programme total: ${formattedTotal}`);
  return summaries.join("; ");
}

function formatFeeItems(items: FeeItemRow[], feeStructure: FeeStructureRow | null, knowledge: CourseKnowledge | null): string {
  // Was .slice(0, 12): D.AOTT has 16 fee items, so its final semester was
  // silently cut off and Navya quoted a 4-semester programme. 40 covers the
  // widest structure (school, every boarding/transport tier) without bloat.
  const relevant = items
    .filter((item) => Number(item.amount || 0) > 0)
    .slice(0, 40)
    .map((item) => {
      // The term string alone cannot say "Semester 3" — the structure metadata
      // can, so pass it in rather than title-casing "year_3" into "Year 3".
      const label = item.term
        ? feeTermLabelLong(item.term, feeStructure?.metadata)
        : item.fee_codes?.name || item.fee_codes?.code || "Fee";
      const code = item.fee_codes?.name || item.fee_codes?.code;
      const money = formatMoney(item.amount);
      return `${label}${code && !label.includes(code) ? ` (${code})` : ""}: ${money}`;
    });
  const metadata = feeMetadataSummary(feeStructure?.metadata);
  const parts = [...relevant];
  if (metadata) parts.push(metadata);
  if (!parts.length && knowledge?.fee) parts.push(`Knowledge file fee: ${knowledge.fee}`);
  if (parts.length) parts.push(`Canonical fee page: ${FEE_STRUCTURE_URL}`);
  return parts.join("; ");
}

async function resolveCourse(admin: SupabaseLike, courseId: string | null, courseName: string | null): Promise<CourseRow | null> {
  if (courseId) {
    const { data } = await admin
      .from("courses")
      .select("id,name,code,duration_years,type,course_summary,curriculum_url")
      .eq("id", courseId)
      .maybeSingle();
    return (data || null) as CourseRow | null;
  }

  if (!courseName) return null;
  const term = courseName.trim();
  const { data } = await admin
    .from("courses")
    .select("id,name,code,duration_years,type,course_summary,curriculum_url")
    .or(`name.ilike.%${term}%,code.ilike.%${term}%`)
    .limit(1)
    .maybeSingle();
  return (data || null) as CourseRow | null;
}

async function loadFeeContext(admin: SupabaseLike, courseId: string | null, knowledge: CourseKnowledge | null): Promise<string> {
  if (!courseId) return knowledge?.fee ? `Knowledge file fee: ${knowledge.fee}; Canonical fee page: ${FEE_STRUCTURE_URL}` : "";

  const { data: feeStructureData } = await admin
    .from("fee_structures")
    .select("id,version,metadata,session_id,admission_sessions(name,is_active)")
    .eq("course_id", courseId)
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const feeStructure = (feeStructureData || null) as FeeStructureRow | null;
  if (!feeStructure?.id) {
    return knowledge?.fee ? `Knowledge file fee: ${knowledge.fee}; Canonical fee page: ${FEE_STRUCTURE_URL}` : "";
  }

  const { data: itemData } = await admin
    .from("fee_structure_items")
    .select("term,amount,fee_codes(name,code)")
    .eq("fee_structure_id", feeStructure.id)
    .order("term", { ascending: true });

  return formatFeeItems((itemData || []) as FeeItemRow[], feeStructure, knowledge);
}

async function loadEligibilityContext(
  admin: SupabaseLike,
  course: CourseRow | null,
  knowledge: CourseKnowledge | null,
): Promise<string> {
  if (!course?.id) return knowledge?.eligibility ? `Knowledge file eligibility: ${knowledge.eligibility}` : "";
  const { data } = await admin
    .from("eligibility_rules")
    .select("min_age,max_age,class_12_min_marks,graduation_min_marks,sc_st_min_marks,requires_graduation,entrance_exam_name,entrance_exam_required,subject_prerequisites,notes")
    .eq("course_id", course.id)
    .maybeSingle();
  return formatEligibility((data || null) as EligibilityRow | null, course, knowledge);
}

/**
 * Render every course's curated facts as a compact block for an AI system prompt.
 *
 * This replaces the hardcoded per-course COURSES: sections that used to live in
 * three separate places (whatsapp-ai-reply's KNOWLEDGE_BASE,
 * web-chat-server/knowledge.ts and voice-agent/knowledge.ts — the latter two
 * byte-identical copies of each other). They drifted from the database and from
 * each other; now there is one list and it comes from public.course_facts.
 *
 * Returns "" on any failure, so a caller falls back to its static text rather
 * than losing the course list entirely.
 */
export async function renderCourseFactsBlock(admin: SupabaseLike): Promise<string> {
  try {
    const { data, error } = await (admin as any)
      .from("course_facts")
      .select(
        "duration, eligibility, entrance_exam, affiliation, intake_seats, fee_first_year," +
          "courses!inner(name, code, is_active, departments(institutions(campuses(name))))",
      )
      .limit(200);
    if (error || !Array.isArray(data) || !data.length) return "";

    const lines: string[] = [];
    const byCampus = new Map<string, string[]>();
    const affiliations = new Set<string>();

    for (const row of data as any[]) {
      const course = row.courses;
      if (!course?.name || course.is_active === false) continue;

      const bits = [
        row.duration ? `Duration: ${row.duration}` : "",
        row.eligibility ? `Eligibility: ${row.eligibility}` : "",
        row.entrance_exam ? `Entrance: ${row.entrance_exam}` : "",
        row.affiliation ? `Affiliation: ${row.affiliation}` : "",
        row.intake_seats ? `Seats: ${row.intake_seats}` : "",
        row.fee_first_year ? `First-year fee: ${row.fee_first_year}` : "",
      ].filter(Boolean);
      if (bits.length) lines.push(`${course.name}${course.code ? ` [${course.code}]` : ""}\n  ${bits.join("\n  ")}`);

      // Which campus runs what, and the affiliation roll-up, are derived here
      // rather than restated in prose — they used to be a second, drifting copy.
      const campus = course.departments?.institutions?.campuses?.name;
      if (campus) {
        if (!byCampus.has(campus)) byCampus.set(campus, []);
        byCampus.get(campus)!.push(course.name);
      }
      for (const a of String(row.affiliation || "").split(/\s*\|\s*/)) {
        const t = a.trim();
        if (t) affiliations.add(t);
      }
    }
    if (!lines.length) return "";

    lines.sort((a, b) => a.localeCompare(b));
    const out = [
      "COURSES — this is the complete and current list. Answer course questions from it, using its wording.",
      "",
      ...lines,
    ];

    if (byCampus.size) {
      out.push("", "WHICH CAMPUS RUNS WHAT:");
      for (const campus of [...byCampus.keys()].sort()) {
        out.push(`${campus}: ${[...new Set(byCampus.get(campus)!)].sort().join(", ")}`);
      }
    }
    if (affiliations.size) {
      out.push("", `AFFILIATIONS AND APPROVALS ACROSS PROGRAMMES: ${[...affiliations].sort().join(", ")}`);
    }
    return out.join("\n");
  } catch {
    return "";
  }
}

/**
 * The curated single source of truth (public.course_facts via fn_course_facts).
 * These are the exact words the website, the counsellor Course tab and the
 * WhatsApp course_info templates show, signed off by admissions. Navya must
 * quote them rather than paraphrase from the knowledge file — the knowledge file
 * and courses.marketing_eligibility disagreed with the DB on eligibility, fee
 * and duration for 21 courses.
 */
async function loadCuratedCourseFacts(
  admin: SupabaseLike,
  courseId: string | null,
): Promise<Record<string, string> | null> {
  if (!courseId) return null;
  try {
    const { data, error } = await (admin as any).rpc("fn_course_facts", {
      p_course_id: courseId,
      p_student_name: null,
    });
    if (error || !data || typeof data !== "object") return null;
    return data as Record<string, string>;
  } catch {
    return null;
  }
}

// Live counselling rounds/deadlines scraped by the counselling-watch cron.
// Stale briefs are worse than none — round dates expire — so drop anything
// older than the window even if the scrape kept the last good summary.
const COUNSELLING_FRESHNESS_DAYS = 7;

// With no fresh scrape the model must be told it has NO dates — returning an
// empty string used to drop the "never state a round date" rule along with the
// data, which is exactly how Navya ended up inventing May/June counselling.
const NO_COUNSELLING_DATA_BLOCK = [
  "LIVE COUNSELLING UPDATES: unavailable right now.",
  "You have NO verified counselling round, registration, seat-allotment or reporting dates.",
  "Do not state, estimate or imply any such date, and do not claim a round has or has not started.",
  "Say the admissions team will confirm the current status and share +91 9555192192.",
].join("\n");

async function loadCounsellingUpdates(admin: SupabaseLike): Promise<string> {
  const cutoff = new Date(Date.now() - COUNSELLING_FRESHNESS_DAYS * 86_400_000).toISOString();
  const { data, error } = await admin
    .from("counselling_sources")
    .select("label,url,scope,summary,fetched_at")
    .eq("is_active", true)
    .not("summary", "is", null)
    .gte("fetched_at", cutoff);

  // A missing table or dead cron must not fail silently again — the scraper was
  // erroring for ten days before anyone noticed the dates had gone stale.
  if (error) console.warn("loadCounsellingUpdates failed:", error.message ?? error);

  const blocks = (data || []).map((row: any) =>
    [
      `Source: ${row.label} (${row.url}) — checked ${String(row.fetched_at).slice(0, 10)}`,
      row.scope ? `Covers: ${row.scope}` : "",
      row.summary,
    ].filter(Boolean).join("\n")
  );
  if (!blocks.length) return NO_COUNSELLING_DATA_BLOCK;

  return [
    "LIVE COUNSELLING UPDATES (official portals, scraped — highest priority for round/date questions):",
    "Use these dates verbatim for counselling round, registration, seat allocation, and reporting deadlines. Never state a round date that is not listed here; if the student asks about a date not covered, say the team will confirm.",
    ...blocks,
  ].join("\n");
}

export async function loadVerifiedAdmissionsContext(
  admin: SupabaseLike,
  courseId: string | null,
  courseName: string | null,
): Promise<string> {
  const course = await resolveCourse(admin, courseId, courseName);
  const knowledgeEntry = findKnowledgeByCourse(course?.name || courseName);
  const knowledge = knowledgeEntry?.[1] || null;
  const facts = await loadCuratedCourseFacts(admin, course?.id || courseId);
  const feeContext = await loadFeeContext(admin, course?.id || courseId, knowledge);
  const eligibilityContext = await loadEligibilityContext(admin, course, knowledge);
  const counsellingContext = await loadCounsellingUpdates(admin);

  const curated = facts?.curated ? facts : null;
  const val = (key: string) => {
    const v = curated?.[key];
    return typeof v === "string" && v.trim() ? v.trim() : "";
  };

  const lines = [
    "VERIFIED ADMISSIONS CONTEXT",
    curated
      ? "Source priority: CURATED COURSE FACTS below are authoritative for eligibility, duration, entrance exam, affiliation, seats and first-year fee — quote them verbatim and never contradict them from the background sections. LIVE COUNSELLING UPDATES, where present, remain authoritative for round and deadline DATES."
      : "Source priority: fee_structures/fee_structure_items + eligibility_rules first; web-chat-server/knowledge.ts second; static fallback last. No curated facts exist for this course.",
    `Official fee page: ${FEE_STRUCTURE_URL}`,
    course ? `Course from DB: ${course.name || course.code} (${course.code || "no code"})` : "",
    // ── Curated facts (authoritative) ─────────────────────────────────────
    curated ? "--- CURATED COURSE FACTS (authoritative) ---" : "",
    val("duration") ? `Duration: ${val("duration")}` : "",
    val("eligibility") ? `Eligibility: ${val("eligibility")}` : "",
    val("entrance_exam") ? `Entrance exam: ${val("entrance_exam")}` : "",
    val("approval") ? `Affiliation/approval: ${val("approval")}` : "",
    val("subjects") ? `Subject requirement: ${val("subjects")}` : "",
    val("age_requirement") ? `Age requirement: ${val("age_requirement")}` : "",
    val("intake_seats") ? `Intake/seats: ${val("intake_seats")}` : "",
    val("fee_first_year") ? `First-year fee: ${val("fee_first_year")}` : "",
    val("course_url") ? `Course page: ${val("course_url")}` : "",
    curated ? "--- END CURATED FACTS ---" : "",
    // ── Background ────────────────────────────────────────────────────────
    course?.course_summary ? `Course summary from DB: ${course.course_summary}` : "",
    !curated && course?.duration_years ? `DB duration: ${course.duration_years} years (${course.type || "programme"})` : "",
    knowledgeEntry ? `Knowledge.ts course key: ${knowledgeEntry[0]}` : "",
    !val("duration") && knowledge?.duration ? `Knowledge.ts duration: ${knowledge.duration}` : "",
    knowledge?.campus ? `Knowledge.ts campus: ${knowledge.campus}` : "",
    !val("eligibility") && eligibilityContext ? `Eligibility: ${eligibilityContext}` : "",
    feeContext ? `Fee structure detail (installments/discounts): ${feeContext}` : "",
    !val("entrance_exam") && knowledge?.entrance ? `Entrance: ${knowledge.entrance}` : "",
    knowledge?.whyNimt ? `Why NIMT: ${knowledge.whyNimt}` : "",
    knowledge?.placementHighlights ? `Placements: ${knowledge.placementHighlights}` : "",
    `Institution overview from knowledge.ts: ${NIMT_OVERVIEW}`,
    `Campus reference from knowledge.ts: ${Object.entries(CAMPUS_INFO).map(([name, info]) => `${name}: ${info}`).join(" | ")}`,
    counsellingContext,
  ].filter(Boolean);

  return lines.join("\n");
}

export { FEE_STRUCTURE_URL };
