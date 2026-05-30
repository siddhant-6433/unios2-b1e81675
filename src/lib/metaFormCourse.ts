// Meta Lead Ad course-answer extraction.
//
// Canonical, pure implementation shared with the lead-ingest edge function.
// The Deno function (supabase/functions/lead-ingest/index.ts) mirrors this
// logic inline because Deno can't import from src/ — keep the two in sync.
// This module is the tested source of truth (src/test/meta-form-course.test.ts).
//
// Meta forms ask the course question under varying field names
// (e.g. "which_course_are_you_interested_in?", "which_programme_are_you_..."),
// and the answer is an option key like "b.sc_nursing" or "llb_(3_years)".
// We normalise underscores → spaces so the value fuzzy-matches a course name
// (e.g. "b.sc_nursing" → "b.sc nursing" matches "B.Sc Nursing"). Values that
// still don't match (e.g. "llb (3 years)") fall back to the form-level mapping.

export interface MetaField {
  name?: string;
  values?: string[];
}

// A field is the "course question" if its name mentions course/programme, but
// NOT stream/qualification (those are different questions we must not treat as
// a course). School forms use class/grade/admission-type — handled by the
// form-level mapping (is_school), not here.
const COURSE_FIELD_RE = /(course|programme|program)/i;
const NON_COURSE_FIELD_RE = /(stream|qualification)/i;

export function isCourseField(name: string): boolean {
  return COURSE_FIELD_RE.test(name) && !NON_COURSE_FIELD_RE.test(name);
}

/** Lowercase + underscores → spaces. Leaves parenthesised qualifiers intact. */
export function normalizeMetaCourseValue(value: string): string {
  return value.replace(/_/g, " ").trim().toLowerCase();
}

/**
 * Pull the normalised course answer from a Meta field_data array, or "" if the
 * form has no course question (e.g. a school enquiry form).
 */
export function extractCourseAnswer(fieldData: MetaField[]): string {
  if (!Array.isArray(fieldData)) return "";
  for (const f of fieldData) {
    const name = (f?.name || "").toString();
    if (!isCourseField(name)) continue;
    const raw = f?.values?.[0];
    if (raw) return normalizeMetaCourseValue(String(raw));
  }
  return "";
}
