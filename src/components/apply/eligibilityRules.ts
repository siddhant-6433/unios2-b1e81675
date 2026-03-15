/**
 * Academic eligibility rules — DB-driven with hardcoded fallback.
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
  subjectMinMarks?: Record<string, number>;
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
  subject_min_marks: Record<string, number> | null;
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
    subjectMinMarks: row.subject_min_marks ?? undefined,
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

/**
 * Parse mandatory individual subjects from prereq strings like "Any Stream (English Mandatory)".
 * Returns array of mandatory subject names.
 */
export function parseMandatorySubjects(prerequisites: string[]): string[] {
  const mandatory: string[] = [];
  for (const prereq of prerequisites) {
    const match = prereq.match(/\(([^)]+)\s+[Mm]andatory\)/);
    if (match) {
      mandatory.push(match[1].trim());
    }
  }
  return mandatory;
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
  additionalQualifications?: Record<string, any>[],
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

  // Graduation marks check — for LLB, check primary + additional qualifications
  if (rules.graduationMinMarks) {
    const grad = academicDetails?.graduation;
    const primaryPasses = checkGraduationMarks(grad, rules.graduationMinMarks);

    // Check additional qualifications too (LLB multi-degree case)
    const additionalPasses = (additionalQualifications || []).some(q =>
      checkGraduationMarks(q, rules.graduationMinMarks!)
    );

    if (!primaryPasses && !additionalPasses) {
      // Only error if primary graduation has marks entered
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

  // Subject prerequisites — expanded group matching + mandatory subject parsing
  if (rules.subjectPrerequisites && rules.subjectPrerequisites.length > 0) {
    const c12 = academicDetails?.class_12;
    const rawSubjects: string = typeof c12?.subjects === 'string' ? c12.subjects : '';
    const studentSubjects = rawSubjects
      .split(',')
      .map((s: string) => s.trim())
      .filter(Boolean);

    const anyStream = rules.subjectPrerequisites.some(
      p => p.toLowerCase().includes('any stream') || p.toLowerCase() === 'any'
    );

    // Check mandatory subjects extracted from parenthetical (e.g., English Mandatory)
    const mandatorySubjects = parseMandatorySubjects(rules.subjectPrerequisites);
    if (mandatorySubjects.length > 0 && c12) {
      if (studentSubjects.length === 0) {
        results.push({
          field: 'class_12',
          message: `Please select your Class 12 subjects. ${mandatorySubjects.join(', ')} is mandatory.`,
          type: 'error',
        });
      } else {
        const normalizedStudent = studentSubjects.map((s: string) => s.toLowerCase());
        for (const mandatory of mandatorySubjects) {
          if (!normalizedStudent.includes(mandatory.toLowerCase())) {
            results.push({
              field: 'class_12',
              message: `${mandatory} is a mandatory subject for this course.`,
              type: 'error',
            });
          }
        }
      }
    }

    if (!anyStream && mandatorySubjects.length === 0) {
      if (c12 && studentSubjects.length > 0) {
        const hasMatch = rules.subjectPrerequisites.some(prereq =>
          isSubjectGroupSatisfied(prereq, studentSubjects)
        );
        if (!hasMatch) {
          const groupLabels = rules.subjectPrerequisites.map(p => {
            const expanded = SUBJECT_GROUP_MAP[p.toUpperCase()];
            return expanded ? `${p} (${expanded.join(', ')})` : p;
          });
          results.push({
            field: 'class_12',
            message: `This course requires one of: ${groupLabels.join(' OR ')} in Class 12.`,
            type: 'error',
          });
        }
      } else if (!c12 || studentSubjects.length === 0) {
        results.push({
          field: 'class_12',
          message: `Please select your Class 12 subjects. Required: ${rules.subjectPrerequisites.join(' / ')}.`,
          type: 'error',
        });
      }
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

/** Helper: check if a graduation record meets min marks */
function checkGraduationMarks(grad: Record<string, any> | undefined, minMarks: number): boolean {
  if (!grad || grad.result_status === 'not_declared') return false;
  const pct = parseMarksToPercentage(grad?.marks);
  return pct !== null && pct >= minMarks;
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

/** Validate academic years: class 10/12 years, gap, graduation year */
export function validateAcademicYears(
  academicDetails: Record<string, any>,
  sessionYear: number,
  requiresGraduation?: boolean,
): ValidationResult[] {
  const results: ValidationResult[] = [];
  const c10Year = parseInt(academicDetails?.class_10?.year);
  const c12Year = parseInt(academicDetails?.class_12?.year);
  const gradYear = parseInt(academicDetails?.graduation?.year);

  if (!isNaN(c10Year) && c10Year > sessionYear - 2) {
    results.push({
      field: 'class_10_year',
      message: `Class 10 year must be ≤ ${sessionYear - 2} for the ${sessionYear}-${(sessionYear + 1).toString().slice(-2)} session.`,
      type: 'error',
    });
  }

  if (!isNaN(c12Year) && c12Year > sessionYear) {
    results.push({
      field: 'class_12_year',
      message: `Class 12 year must be ≤ ${sessionYear} for the ${sessionYear}-${(sessionYear + 1).toString().slice(-2)} session.`,
      type: 'error',
    });
  }

  if (!isNaN(c10Year) && !isNaN(c12Year) && c12Year - c10Year < 2) {
    results.push({
      field: 'class_12_year',
      message: `Gap between Class 10 (${c10Year}) and Class 12 (${c12Year}) must be at least 2 years.`,
      type: 'error',
    });
  }

  if (requiresGraduation && !isNaN(gradYear) && gradYear > sessionYear) {
    results.push({
      field: 'graduation_year',
      message: `Graduation year must be ≤ ${sessionYear} for the ${sessionYear}-${(sessionYear + 1).toString().slice(-2)} session.`,
      type: 'error',
    });
  }

  return results;
}

/** Per-course eligibility result */
export interface CourseEligibilityResult {
  courseId: string;
  courseName: string;
  campusName: string;
  preferenceOrder: number;
  results: ValidationResult[];
  dobResult: ValidationResult | null;
  yearResults: ValidationResult[];
  hasErrors: boolean;
}

/** Validate eligibility for each course preference independently */
export function validatePerCourseEligibility(
  programCategory: string,
  academicDetails: Record<string, any>,
  dob: string,
  courseSelections: { course_id: string; course_name: string; campus_name: string; preference_order: number }[],
  courseRules: Record<string, EligibilityRule>,
  sessionYear: number,
  additionalQualifications?: Record<string, any>[],
): CourseEligibilityResult[] {
  return courseSelections.map(cs => {
    const rule = courseRules[cs.course_id];
    const results = validateAcademicEligibility(programCategory, academicDetails, rule, additionalQualifications);
    const dobResult = validateDobEligibility(programCategory, dob, sessionYear, rule);
    const yearResults = validateAcademicYears(academicDetails, sessionYear, rule?.requiresGraduation);
    const hasErrors = results.some(r => r.type === 'error')
      || dobResult?.type === 'error'
      || yearResults.some(r => r.type === 'error');

    return {
      courseId: cs.course_id,
      courseName: cs.course_name,
      campusName: cs.campus_name,
      preferenceOrder: cs.preference_order,
      results,
      dobResult,
      yearResults,
      hasErrors: !!hasErrors,
    };
  });
}
