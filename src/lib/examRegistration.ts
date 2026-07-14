/**
 * Central source of truth for entrance-exam / counselling registration
 * tracking across admissions.
 *
 * Previously each exam had its own table + components (cahet_registrations,
 * updeled_registrations, plus a UPGET-from-metadata path). This module
 * generalizes the concept: a single `exam_registrations` table keyed by
 * (lead_id, exam_code), one course→exam mapping, and one candidate-facing
 * display name per exam.
 *
 * The exam a candidate must clear depends on their COURSE — and for B.Ed,
 * on their CAMPUS (Kotputli sits under Rajasthan's PTET; the UP/NCR B.Ed
 * campuses use JEE B.Ed). See examCodeForCourse().
 */

import { isDeledCourseName } from "@/lib/updeled";
import { isBptOrBmritCourseName } from "@/lib/cahet";

export type ExamCode =
  | "cahet"
  | "cnet"
  | "updeled"
  | "jeecup"
  | "ptet"
  | "jee_bed"
  | "upget";

export const EXAM_CODES: ExamCode[] = [
  "cahet",
  "cnet",
  "updeled",
  "jeecup",
  "ptet",
  "jee_bed",
  "upget",
];

/**
 * Full candidate-facing names — used in WhatsApp copy and registration
 * dialogs where the candidate needs to recognise exactly which exam /
 * counselling body we mean.
 */
export const EXAM_DISPLAY_NAMES: Record<ExamCode, string> = {
  cahet: "CAHET (Conducted by ABVMU Lucknow)",
  cnet: "CNET (BSc Nursing - Conducted by ABVMU Lucknow)",
  updeled: "UPDELED Counselling",
  jeecup: "JEECUP",
  ptet: "PTET",
  jee_bed: "JEE B.Ed",
  upget: "UPGET",
};

/** Compact labels for badges / table cells. */
export const EXAM_SHORT_LABELS: Record<ExamCode, string> = {
  cahet: "CAHET",
  cnet: "CNET",
  updeled: "UPDELED",
  jeecup: "JEECUP",
  ptet: "PTET",
  jee_bed: "JEE B.Ed",
  upget: "UPGET",
};

/**
 * Registration lifecycle for a (lead, exam) pair:
 *   unknown              — we don't yet know if the candidate registered.
 *   not_registered       — candidate confirmed they have NOT registered.
 *   registered_no_number — candidate says registered but hasn't given a no.
 *   registered           — registration number captured.
 */
export type ExamRegistrationStatus =
  | "unknown"
  | "not_registered"
  | "registered_no_number"
  | "registered";

// ── Course matchers ────────────────────────────────────────────────────────

/** GNM (General Nursing & Midwifery) → UPGET. Must be checked before the
 *  generic B.Sc-Nursing matcher, since "General Nursing" also contains
 *  "nursing". */
export function isGnmCourseName(courseName: string | null | undefined): boolean {
  const c = String(courseName || "").toLowerCase();
  return c.includes("gnm") || c.includes("general nursing");
}

/** B.Sc Nursing → CNET. Explicitly excludes GNM (that's UPGET). */
export function isBscNursingCourseName(courseName: string | null | undefined): boolean {
  const c = String(courseName || "").toLowerCase();
  if (isGnmCourseName(c)) return false;
  if (!c.includes("nursing")) return false;
  return c.includes("b.sc") || c.includes("bsc") || c.includes("bachelor of science");
}

/** D.Pharma → JEECUP. */
export function isDPharmaCourseName(courseName: string | null | undefined): boolean {
  const c = String(courseName || "").toLowerCase();
  return (
    c.includes("d.pharma") ||
    c.includes("d pharma") ||
    (c.includes("diploma") && c.includes("pharmac"))
  );
}

/** B.Ed (Bachelor of Education) — exam depends on campus (see below).
 *  D.El.Ed is handled separately (updeled) and must be matched first. */
export function isBedCourseName(courseName: string | null | undefined): boolean {
  const c = String(courseName || "").toLowerCase();
  if (isDeledCourseName(c)) return false;
  return c.includes("b.ed") || (c.includes("bachelor") && c.includes("education"));
}

/** For B.Ed, the entrance exam is decided by campus: Kotputli (Rajasthan)
 *  → PTET, all other (UP/NCR) B.Ed campuses → JEE B.Ed. */
export function bedExamForCampus(campusName: string | null | undefined): Extract<ExamCode, "ptet" | "jee_bed"> {
  return /kotputli/i.test(String(campusName || "")) ? "ptet" : "jee_bed";
}

/**
 * The single entrance exam a course+campus requires, or null if the course
 * has no registration/counselling gate. Order matters — more specific
 * matchers first.
 */
export function examCodeForCourse(
  courseName: string | null | undefined,
  campusName?: string | null | undefined,
): ExamCode | null {
  const name = String(courseName || "");
  if (!name.trim()) return null;
  if (isDeledCourseName(name)) return "updeled";
  if (isGnmCourseName(name)) return "upget";
  if (isBscNursingCourseName(name)) return "cnet";
  if (isDPharmaCourseName(name)) return "jeecup";
  if (isBedCourseName(name)) return bedExamForCampus(campusName);
  if (isBptOrBmritCourseName(name)) return "cahet";
  return null;
}

interface CourseSelectionLike {
  course_name?: string | null;
  name?: string | null;
  campus_name?: string | null;
}

/**
 * The entrance exam relevant to an application, derived from its course
 * selections. Returns the first selection that maps to an exam (candidates
 * typically have one meaningful selection). Null when none apply.
 */
export function examCodeForApplication(app: {
  course_selections?: CourseSelectionLike[] | null;
} | null | undefined): ExamCode | null {
  const selections = app?.course_selections;
  if (!Array.isArray(selections)) return null;
  for (const sel of selections) {
    const code = examCodeForCourse(sel?.course_name || sel?.name, sel?.campus_name);
    if (code) return code;
  }
  return null;
}

// ── Status presentation ─────────────────────────────────────────────────────

export function examStatusLabel(status: ExamRegistrationStatus): string {
  switch (status) {
    case "registered":
      return "Registered";
    case "registered_no_number":
      return "Registered · no number";
    case "not_registered":
      return "Not Registered";
    default:
      return "Unknown";
  }
}

/** Tailwind classes for a status badge. */
export function examStatusClass(status: ExamRegistrationStatus): string {
  switch (status) {
    case "registered":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "registered_no_number":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "not_registered":
      return "border-rose-200 bg-rose-50 text-rose-700";
    default:
      return "border-border bg-muted/40 text-muted-foreground";
  }
}
