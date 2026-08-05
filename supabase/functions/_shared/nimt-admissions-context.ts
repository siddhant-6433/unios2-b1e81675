import {
  CAMPUS_INFO,
  COURSE_KNOWLEDGE,
  NIMT_OVERVIEW,
} from "../../../web-chat-server/knowledge.ts";

const FEE_STRUCTURE_URL = "https://nimt.ac.in/admissions/fees/";

type SupabaseLike = {
  from: (table: string) => any;
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
  marketing_eligibility?: string | null;
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

function titleCaseTerm(term: string): string {
  return term
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
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
  if (course?.marketing_eligibility) parts.push(`Customer-facing eligibility: ${course.marketing_eligibility}`);
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
  const yearWise = metadata.year_wise || metadata.yearWise || metadata.years;
  if (yearWise && typeof yearWise === "object" && !Array.isArray(yearWise)) {
    for (const [key, value] of Object.entries(yearWise as Record<string, unknown>).slice(0, 6)) {
      if (typeof value === "number" || typeof value === "string") {
        const money = formatMoney(value);
        if (money) summaries.push(`${titleCaseTerm(key)}: ${money}`);
      }
    }
  }
  const total = metadata.total || metadata.programme_total || metadata.programmeTotal;
  const formattedTotal = formatMoney(total as number | string | null);
  if (formattedTotal) summaries.push(`Programme total: ${formattedTotal}`);
  return summaries.join("; ");
}

function formatFeeItems(items: FeeItemRow[], feeStructure: FeeStructureRow | null, knowledge: CourseKnowledge | null): string {
  const relevant = items
    .filter((item) => Number(item.amount || 0) > 0)
    .slice(0, 12)
    .map((item) => {
      const label = item.term ? titleCaseTerm(item.term) : item.fee_codes?.name || item.fee_codes?.code || "Fee";
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
      .select("id,name,code,duration_years,type,marketing_eligibility,course_summary,curriculum_url")
      .eq("id", courseId)
      .maybeSingle();
    return (data || null) as CourseRow | null;
  }

  if (!courseName) return null;
  const term = courseName.trim();
  const { data } = await admin
    .from("courses")
    .select("id,name,code,duration_years,type,marketing_eligibility,course_summary,curriculum_url")
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

// Live counselling rounds/deadlines scraped by the counselling-watch cron.
// Stale briefs are worse than none — round dates expire — so drop anything
// older than the window even if the scrape kept the last good summary.
const COUNSELLING_FRESHNESS_DAYS = 7;

async function loadCounsellingUpdates(admin: SupabaseLike): Promise<string> {
  const cutoff = new Date(Date.now() - COUNSELLING_FRESHNESS_DAYS * 86_400_000).toISOString();
  const { data } = await admin
    .from("counselling_sources")
    .select("label,url,scope,summary,fetched_at")
    .eq("is_active", true)
    .not("summary", "is", null)
    .gte("fetched_at", cutoff);

  const blocks = (data || []).map((row: any) =>
    [
      `Source: ${row.label} (${row.url}) — checked ${String(row.fetched_at).slice(0, 10)}`,
      row.scope ? `Covers: ${row.scope}` : "",
      row.summary,
    ].filter(Boolean).join("\n")
  );
  if (!blocks.length) return "";

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
  const feeContext = await loadFeeContext(admin, course?.id || courseId, knowledge);
  const eligibilityContext = await loadEligibilityContext(admin, course, knowledge);
  const counsellingContext = await loadCounsellingUpdates(admin);

  const lines = [
    "VERIFIED ADMISSIONS CONTEXT",
    "Source priority: fee_structures/fee_structure_items + courses.marketing_eligibility/eligibility_rules first; web-chat-server/knowledge.ts second; static fallback last.",
    `Official fee page: ${FEE_STRUCTURE_URL}`,
    course ? `Course from DB: ${course.name || course.code} (${course.code || "no code"})` : "",
    course?.course_summary ? `Course summary from DB: ${course.course_summary}` : "",
    course?.duration_years ? `DB duration: ${course.duration_years} years (${course.type || "programme"})` : "",
    knowledgeEntry ? `Knowledge.ts course key: ${knowledgeEntry[0]}` : "",
    knowledge?.duration ? `Knowledge.ts duration: ${knowledge.duration}` : "",
    knowledge?.campus ? `Knowledge.ts campus: ${knowledge.campus}` : "",
    eligibilityContext ? `Eligibility: ${eligibilityContext}` : "",
    feeContext ? `Fees: ${feeContext}` : "",
    knowledge?.entrance ? `Entrance: ${knowledge.entrance}` : "",
    knowledge?.whyNimt ? `Why NIMT: ${knowledge.whyNimt}` : "",
    knowledge?.placementHighlights ? `Placements: ${knowledge.placementHighlights}` : "",
    `Institution overview from knowledge.ts: ${NIMT_OVERVIEW}`,
    `Campus reference from knowledge.ts: ${Object.entries(CAMPUS_INFO).map(([name, info]) => `${name}: ${info}`).join(" | ")}`,
    counsellingContext,
  ].filter(Boolean);

  return lines.join("\n");
}

export { FEE_STRUCTURE_URL };
