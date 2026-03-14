/**
 * Academic eligibility rules per program_category.
 * Marks parsing: values ≤ 10 treated as CGPA → converted via CGPA × 9.5.
 */

export interface EligibilityRule {
  minAge?: number; // minimum age as of July 31 of admission year
  class12MinMarks?: number; // percentage
  graduationMinMarks?: number; // percentage
}

export const ELIGIBILITY_RULES: Record<string, EligibilityRule> = {
  school: {},
  undergraduate: { minAge: 17, class12MinMarks: 45 },
  postgraduate: { minAge: 20, graduationMinMarks: 50 },
  mba_pgdm: { minAge: 20, graduationMinMarks: 50 },
  professional: { minAge: 17, class12MinMarks: 50 },
  bed: { minAge: 20, graduationMinMarks: 50 },
  deled: { minAge: 17, class12MinMarks: 45 },
};

/** Parse marks string to percentage. Values ≤ 10 are treated as CGPA (×9.5). */
export function parseMarksToPercentage(marks: string | undefined): number | null {
  if (!marks) return null;
  const cleaned = marks.replace(/[%\s]/g, '');
  const num = parseFloat(cleaned);
  if (isNaN(num)) return null;
  if (num <= 10) return num * 9.5; // CGPA → percentage
  return num;
}

/** Calculate age as of July 31 of the given admission year. */
export function calculateAgeAsOfJuly(dob: string, admissionYear: number): number | null {
  if (!dob) return null;
  const birthDate = new Date(dob);
  if (isNaN(birthDate.getTime())) return null;
  const cutoff = new Date(admissionYear, 6, 31); // July 31
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
  type: 'error' | 'warning';
}

export function validateAcademicEligibility(
  programCategory: string,
  academicDetails: Record<string, any>,
): ValidationResult[] {
  const rules = ELIGIBILITY_RULES[programCategory];
  if (!rules) return [];
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

  return results;
}

export function validateDobEligibility(
  programCategory: string,
  dob: string,
  admissionYear: number = new Date().getFullYear(),
): ValidationResult | null {
  const rules = ELIGIBILITY_RULES[programCategory];
  if (!rules?.minAge || !dob) return null;
  const age = calculateAgeAsOfJuly(dob, admissionYear);
  if (age === null) return null;
  if (age < rules.minAge) {
    return {
      field: 'dob',
      message: `Minimum age ${rules.minAge} years required (as of July 31, ${admissionYear}). Applicant is ${age} years old.`,
      type: 'error',
    };
  }
  return null;
}
