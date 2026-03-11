/**
 * Age validation engine for school admissions.
 * Age is calculated as of July 31st of the admission year.
 */

export interface GradeAgeRule {
  grade: string;
  /** Keywords to match course name/code */
  keywords: string[];
  /** Minimum age in years (as of July 31) */
  minAge: number;
  /** Maximum age in years (as of July 31) */
  maxAge: number;
}

// NIMT Beacon School: Toddlers to Grade X, strict enforcement for early grades
export const NIMT_BEACON_GRADES: GradeAgeRule[] = [
  { grade: "Toddlers", keywords: ["toddler"], minAge: 1.5, maxAge: 2.5 },
  { grade: "Montessori / Playgroup", keywords: ["montessori", "playgroup"], minAge: 2, maxAge: 3.5 },
  { grade: "Pre-Nursery", keywords: ["pre nur", "pre-nur"], minAge: 2.5, maxAge: 4 },
  { grade: "Nursery", keywords: ["nursery"], minAge: 3, maxAge: 4.5 },
  { grade: "LKG", keywords: ["lkg", "lower kg"], minAge: 3.5, maxAge: 5 },
  { grade: "UKG", keywords: ["ukg", "upper kg"], minAge: 4.5, maxAge: 6 },
  { grade: "Grade I", keywords: ["grade i", "grade 1", "class 1", "class i"], minAge: 5.5, maxAge: 7 },
  { grade: "Grade II", keywords: ["grade ii", "grade 2", "class 2", "class ii"], minAge: 6, maxAge: 8 },
  { grade: "Grade III", keywords: ["grade iii", "grade 3", "class 3", "class iii"], minAge: 7, maxAge: 9 },
  { grade: "Grade IV", keywords: ["grade iv", "grade 4", "class 4", "class iv"], minAge: 8, maxAge: 10 },
  { grade: "Grade V", keywords: ["grade v", "grade 5", "class 5", "class v"], minAge: 9, maxAge: 11 },
  { grade: "Grade VI", keywords: ["grade vi", "grade 6", "class 6", "class vi"], minAge: 10, maxAge: 12 },
  { grade: "Grade VII", keywords: ["grade vii", "grade 7", "class 7", "class vii"], minAge: 11, maxAge: 13 },
  { grade: "Grade VIII", keywords: ["grade viii", "grade 8", "class 8", "class viii"], minAge: 12, maxAge: 14 },
  { grade: "Grade IX", keywords: ["grade ix", "grade 9", "class 9", "class ix"], minAge: 13, maxAge: 15 },
  { grade: "Grade X", keywords: ["grade x", "grade 10", "class 10", "class x"], minAge: 14, maxAge: 16 },
];

// Mirai School: Nursery to Grade V, age as guidance (not strict block)
export const MIRAI_GRADES: GradeAgeRule[] = [
  { grade: "Nursery", keywords: ["nursery"], minAge: 3, maxAge: 4.5 },
  { grade: "LKG", keywords: ["lkg", "lower kg"], minAge: 3.5, maxAge: 5 },
  { grade: "UKG", keywords: ["ukg", "upper kg"], minAge: 4.5, maxAge: 6 },
  { grade: "Grade I", keywords: ["grade i", "grade 1", "class 1", "class i"], minAge: 5.5, maxAge: 7 },
  { grade: "Grade II", keywords: ["grade ii", "grade 2", "class 2", "class ii"], minAge: 6, maxAge: 8 },
  { grade: "Grade III", keywords: ["grade iii", "grade 3", "class 3", "class iii"], minAge: 7, maxAge: 9 },
  { grade: "Grade IV", keywords: ["grade iv", "grade 4", "class 4", "class iv"], minAge: 8, maxAge: 10 },
  { grade: "Grade V", keywords: ["grade v", "grade 5", "class 5", "class v"], minAge: 9, maxAge: 11 },
];

/**
 * Calculate age in years (with decimals) as of July 31 of the admission year.
 */
export function calculateAgeAsOfJuly31(dob: string, admissionYear?: number): number {
  const birthDate = new Date(dob);
  if (isNaN(birthDate.getTime())) return -1;

  const year = admissionYear || new Date().getFullYear();
  const refDate = new Date(year, 6, 31); // July 31

  let ageYears = refDate.getFullYear() - birthDate.getFullYear();
  const monthDiff = refDate.getMonth() - birthDate.getMonth();
  const dayDiff = refDate.getDate() - birthDate.getDate();

  if (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0)) {
    ageYears--;
  }

  // Calculate fractional part
  const lastBirthday = new Date(refDate.getFullYear() - (monthDiff < 0 || (monthDiff === 0 && dayDiff < 0) ? 1 : 0), birthDate.getMonth(), birthDate.getDate());
  if (lastBirthday > refDate) lastBirthday.setFullYear(lastBirthday.getFullYear() - 1);
  const nextBirthday = new Date(lastBirthday);
  nextBirthday.setFullYear(nextBirthday.getFullYear() + 1);
  const fraction = (refDate.getTime() - lastBirthday.getTime()) / (nextBirthday.getTime() - lastBirthday.getTime());

  return ageYears + fraction;
}

export type AgeValidationResult = {
  eligible: boolean;
  /** "strict" means blocked, "guidance" means warning only */
  enforcement: "strict" | "guidance";
  message: string;
  ageAsOfJuly31: number;
  matchedGrade: string | null;
};

/**
 * Validate if a child's DOB is appropriate for a given course.
 */
export function validateAge(
  dob: string,
  courseName: string,
  courseCode: string,
  portalId: "nimt" | "beacon" | "mirai",
  admissionYear?: number
): AgeValidationResult {
  const age = calculateAgeAsOfJuly31(dob, admissionYear);
  if (age < 0) return { eligible: true, enforcement: "guidance", message: "", ageAsOfJuly31: 0, matchedGrade: null };

  const rules = portalId === "mirai" ? MIRAI_GRADES : NIMT_BEACON_GRADES;
  const enforcement = portalId === "mirai" ? "guidance" : "strict";
  const nameAndCode = (courseName + " " + courseCode).toLowerCase();

  // Find matching grade rule
  const rule = rules.find(r => r.keywords.some(kw => nameAndCode.includes(kw)));
  if (!rule) return { eligible: true, enforcement: "guidance", message: "", ageAsOfJuly31: age, matchedGrade: null };

  const roundedAge = Math.round(age * 10) / 10;

  if (age < rule.minAge) {
    return {
      eligible: false,
      enforcement,
      message: `Child will be ${roundedAge} years as of July 31. Minimum age for ${rule.grade} is ${rule.minAge} years.`,
      ageAsOfJuly31: roundedAge,
      matchedGrade: rule.grade,
    };
  }
  if (age > rule.maxAge) {
    return {
      eligible: false,
      enforcement,
      message: `Child will be ${roundedAge} years as of July 31. Maximum age for ${rule.grade} is ${rule.maxAge} years.`,
      ageAsOfJuly31: roundedAge,
      matchedGrade: rule.grade,
    };
  }

  return { eligible: true, enforcement, message: `Age ${roundedAge} years as of July 31 — eligible for ${rule.grade}.`, ageAsOfJuly31: roundedAge, matchedGrade: rule.grade };
}

/**
 * Filter courses based on DOB eligibility.
 * Returns courses with age validation info attached.
 */
export function filterCoursesByAge(
  courses: any[],
  dob: string,
  portalId: "nimt" | "beacon" | "mirai",
  admissionYear?: number
): (any & { ageValidation: AgeValidationResult })[] {
  return courses.map(c => ({
    ...c,
    ageValidation: validateAge(dob, c.name, c.code, portalId, admissionYear),
  }));
}
