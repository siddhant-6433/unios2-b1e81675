/**
 * Academic eligibility rules — now DB-driven with hardcoded fallback.
 * Marks parsing: values ≤ 10 treated as CGPA → converted via CGPA × 9.5.
 */

import { supabase } from "@/integrations/supabase/client";

export interface EligibilityRule {
  minAge?: number;
  maxAge?: number;
  class12MinMarks?: number;
  graduationMinMarks?: number;
  requiresGraduation?: boolean;
  entranceExamName?: string;
  entranceExamRequired?: boolean;
  subjectPrerequisites?: string[];
  notes?: string;
}

/** DB row shape */
export interface EligibilityRuleDB {
  id: string;
  course_id: string;
  min_age: number | null;
  max_age: number | null;
  class_12_min_marks: number | null;
  graduation_min_marks: number | null;
  requires_graduation: boolean;
  entrance_exam_name: string | null;
  entrance_exam_required: boolean;
  subject_prerequisites: string[] | null;
  notes: string | null;
}

/** Convert DB row to internal rule */
export function dbRuleToEligibility(row: EligibilityRuleDB): EligibilityRule {
  return {
    minAge: row.min_age ?? undefined,
    maxAge: row.max_age ?? undefined,
    class12MinMarks: row.class_12_min_marks ?? undefined,
    graduationMinMarks: row.graduation_min_marks ?? undefined,
    requiresGraduation: row.requires_graduation,
    entranceExamName: row.entrance_exam_name ?? undefined,
    entranceExamRequired: row.entrance_exam_required,
    subjectPrerequisites: row.subject_prerequisites ?? undefined,
    notes: row.notes ?? undefined,
  };
}

/** Fetch eligibility rules for a set of course IDs from DB. Returns map of courseId → rule. */
export async function fetchEligibilityRules(courseIds: string[]): Promise<Record<string, EligibilityRule>> {
  if (!courseIds.length) return {};
  const { data, error } = await supabase
    .from("eligibility_rules")
    .select("*")
    .in("course_id", courseIds);
  if (error || !data) return {};
  const map: Record<string, EligibilityRule> = {};
  for (const row of data as unknown as EligibilityRuleDB[]) {
    map[row.course_id] = dbRuleToEligibility(row);
  }
  return map;
}

/** Hardcoded fallback rules by program_category (legacy) */
export const ELIGIBILITY_RULES: Record<string, EligibilityRule> = {
  school: {},
  undergraduate: { minAge: 17, class12MinMarks: 45 },
  postgraduate: { minAge: 20, graduationMinMarks: 50, requiresGraduation: true },
  mba_pgdm: { minAge: 20, graduationMinMarks: 50, requiresGraduation: true },
  professional: { minAge: 17, class12MinMarks: 50 },
  bed: { minAge: 20, graduationMinMarks: 50, requiresGraduation: true },
  deled: { minAge: 17, class12MinMarks: 45 },
};

/** Subject group expansion map — acronym → required individual subjects */
export const SUBJECT_GROUP_MAP: Record<string, string[]> = {
  PCB: ['Physics', 'Chemistry', 'Biology'],
  PCM: ['Physics', 'Chemistry', 'Mathematics'],
  PCMB: ['Physics', 'Chemistry', 'Mathematics', 'Biology'],
  Commerce: ['Accountancy', 'Business Studies', 'Economics'],
};

/** Check if a prerequisite group is satisfied by the student's selected subjects */
export function isSubjectGroupSatisfied(group: string, studentSubjects: string[]): boolean {
  const normalizedStudentSubjects = studentSubjects.map(s => s.toLowerCase().trim());
  // "Any Stream" means no restriction
  if (group.toLowerCase().includes('any stream') || group.toLowerCase() === 'any') return true;
  // Check if it's a known acronym
  const expanded = SUBJECT_GROUP_MAP[group.toUpperCase()];
  if (expanded) {
    return expanded.every(req => normalizedStudentSubjects.includes(req.toLowerCase()));
  }
  // Treat as a single subject name
  return normalizedStudentSubjects.includes(group.toLowerCase());
}

/** Parse marks string to percentage. Values ≤ 10 are treated as CGPA (×9.5). */
export function parseMarksToPercentage(marks: string | undefined): number | null {
  if (!marks) return null;
  const cleaned = marks.replace(/[%\s]/g, '');
  const num = parseFloat(cleaned);
  if (isNaN(num)) return null;
  if (num <= 10) return num * 9.5;
  return num;
}

/** Calculate age as of July 31 of the given admission year. */
export function calculateAgeAsOfJuly(dob: string, admissionYear: number): number | null {
  if (!dob) return null;
  const birthDate = new Date(dob);
  if (isNaN(birthDate.getTime())) return null;
  const cutoff = new Date(admissionYear, 6, 31);
  let age = cutoff.getFullYear() - birthDate.getFullYear();
  const monthDiff = cutoff.getMonth() - birthDate.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && cutoff.getDate() < birthDate.getDate())) {
    age--;
  }
  return age;
}

export interface ValidationResult {
  field: string;
  message: string;
  type: 'error' | 'warning' | 'info';
}

/** Get the effective rule for a program category or course-specific override */
function getRule(programCategory: string, courseRule?: EligibilityRule): EligibilityRule {
  return courseRule || ELIGIBILITY_RULES[programCategory] || {};
}

export function validateAcademicEligibility(
  programCategory: string,
  academicDetails: Record<string, any>,
  courseRule?: EligibilityRule,
): ValidationResult[] {
  const rules = getRule(programCategory, courseRule);
  const results: ValidationResult[] = [];

  // Class 12 marks check
  if (rules.class12MinMarks) {
    const c12 = academicDetails?.class_12;
    if (c12 && c12.result_status !== 'not_declared') {
      const pct = parseMarksToPercentage(c12?.marks);
      if (pct !== null && pct < rules.class12MinMarks) {
        results.push({
          field: 'class_12',
          message: `Minimum ${rules.class12MinMarks}% required in Class 12. You have ${pct.toFixed(1)}%.`,
          type: 'error',
        });
      }
    }
  }

  // Graduation marks check
  if (rules.graduationMinMarks) {
    const grad = academicDetails?.graduation;
    if (grad && grad.result_status !== 'not_declared') {
      const pct = parseMarksToPercentage(grad?.marks);
      if (pct !== null && pct < rules.graduationMinMarks) {
        results.push({
          field: 'graduation',
          message: `Minimum ${rules.graduationMinMarks}% required in Graduation. You have ${pct.toFixed(1)}%.`,
          type: 'error',
        });
      }
    }
  }

  // Requires graduation check
  if (rules.requiresGraduation) {
    const grad = academicDetails?.graduation;
    if (!grad || (!grad.degree && !grad.university && !grad.marks && grad.result_status !== 'not_declared')) {
      results.push({
        field: 'graduation',
        message: 'This course requires a completed Graduation / UG degree.',
        type: 'warning',
      });
    }
  }

  // Subject prerequisites
  if (rules.subjectPrerequisites && rules.subjectPrerequisites.length > 0) {
    const c12 = academicDetails?.class_12;
    const subjects = c12?.subjects?.toLowerCase() || '';
    const hasMatch = rules.subjectPrerequisites.some(
      prereq => subjects.includes(prereq.toLowerCase())
    );
    if (c12 && subjects && !hasMatch) {
      results.push({
        field: 'class_12',
        message: `This course requires one of: ${rules.subjectPrerequisites.join(', ')} stream in Class 12.`,
        type: 'error',
      });
    } else if (!subjects && c12) {
      results.push({
        field: 'class_12',
        message: `Please enter your Class 12 subjects. Required: ${rules.subjectPrerequisites.join(' / ')}.`,
        type: 'warning',
      });
    }
  }

  // Entrance exam info
  if (rules.entranceExamRequired && rules.entranceExamName) {
    results.push({
      field: 'entrance_exam',
      message: `Entrance exam required: ${rules.entranceExamName}`,
      type: 'info',
    });
  }

  // Notes
  if (rules.notes) {
    results.push({
      field: 'notes',
      message: rules.notes,
      type: 'info',
    });
  }

  return results;
}

export function validateDobEligibility(
  programCategory: string,
  dob: string,
  admissionYear: number = new Date().getFullYear(),
  courseRule?: EligibilityRule,
): ValidationResult | null {
  const rules = getRule(programCategory, courseRule);
  if (!dob) return null;
  const age = calculateAgeAsOfJuly(dob, admissionYear);
  if (age === null) return null;

  if (rules.minAge && age < rules.minAge) {
    return {
      field: 'dob',
      message: `Minimum age ${rules.minAge} years required (as of July 31, ${admissionYear}). Applicant is ${age} years old.`,
      type: 'error',
    };
  }
  if (rules.maxAge && age > rules.maxAge) {
    return {
      field: 'dob',
      message: `Maximum age ${rules.maxAge} years allowed (as of July 31, ${admissionYear}). Applicant is ${age} years old.`,
      type: 'error',
    };
  }
  return null;
}
