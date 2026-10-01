/**
 * CBSE assessment defaults for the Beacon school classes.
 *
 * These are starting points only: every value is editable in the Assessment
 * Policies editor. The source of truth for the school's final choices remains
 * the approved policy (with its own curriculum source URL), not this file.
 */
import type { ComponentRule, PolicyRules, SubjectRule } from "./cbseExams";

export const CBSE_SOURCE_URL = "https://cbseacademic.nic.in/curriculum_2027.html";

/** CBSE eight-point scale used for Classes IX–XII. */
export const CBSE_GRADE_BANDS: PolicyRules["grade_bands"] = [
  { min: 91, grade: "A1" },
  { min: 81, grade: "A2" },
  { min: 71, grade: "B1" },
  { min: 61, grade: "B2" },
  { min: 51, grade: "C1" },
  { min: 41, grade: "C2" },
  { min: 33, grade: "D" },
  { min: 0, grade: "E" },
];

export type CbseDefaultSubject = {
  code: string;
  name: string;
  is_elective: boolean;
  is_co_scholastic: boolean;
};

const subject = (code: string, name: string, is_elective = false, is_co_scholastic = false): CbseDefaultSubject => ({ code, name, is_elective, is_co_scholastic });

const PRE_PRIMARY: CbseDefaultSubject[] = [
  subject("ENG", "English"),
  subject("HIN", "Hindi"),
  subject("MAT", "Maths"),
  subject("GK", "GK / Art", false, true),
  subject("POEM", "Poem Recitation", false, true),
];

const PRIMARY: CbseDefaultSubject[] = [
  subject("ENG", "English"),
  subject("HIN", "Hindi"),
  subject("MAT", "Mathematics"),
  subject("EVS", "Environmental Studies"),
  subject("GK", "General Knowledge", false, true),
  subject("COMP", "Computer", false, true),
  subject("ART", "Art", false, true),
];

const UPPER_PRIMARY: CbseDefaultSubject[] = [
  subject("ENG", "English"),
  subject("HIN", "Hindi"),
  subject("MAT", "Mathematics"),
  subject("SCI", "Science"),
  subject("SST", "Social Science"),
  subject("COMP", "Computer", false, true),
  subject("GK", "General Knowledge", false, true),
  subject("ART", "Art", false, true),
];

const SECONDARY: CbseDefaultSubject[] = [
  subject("ENG", "English"),
  subject("HIN", "Hindi"),
  subject("MAT", "Mathematics"),
  subject("SCI", "Science"),
  subject("SST", "Social Science"),
];

const SENIOR: CbseDefaultSubject[] = [
  subject("ENG", "English"),
  subject("PHY", "Physics", true),
  subject("CHE", "Chemistry", true),
  subject("MAT", "Mathematics", true),
  subject("BIO", "Biology", true),
  subject("ECO", "Economics", true),
  subject("ACC", "Accountancy", true),
  subject("BST", "Business Studies", true),
  subject("HIS", "History", true),
  subject("POL", "Political Science", true),
  subject("CS", "Computer Science", true),
  subject("PE", "Physical Education", true),
];

/** Subject set for a Beacon class. Pre-primary classes have no formal subjects. */
export function cbseSubjectsForGrade(grade: number | null): CbseDefaultSubject[] {
  if (grade === null || grade < 0 || grade > 12) return [];
  if (grade === 0) return PRE_PRIMARY;
  if (grade <= 5) return PRIMARY;
  if (grade <= 8) return UPPER_PRIMARY;
  if (grade <= 10) return SECONDARY;
  return SENIOR;
}

const XI_XII_PRACTICAL = new Set(["PHY", "CHE", "BIO", "CS", "PE"]);

/** Component maxima pattern for a subject, from the CBSE scheme for the class. */
export function cbseComponentsFor(grade: number | null, code: string): ComponentRule[] {
  const subjectCode = code.toUpperCase();
  if (grade === 0) return [
    { key: "written", label: "Written", max: 50, pass_percent: null },
    { key: "oral", label: "Oral", max: 50, pass_percent: null },
  ];
  if (grade === null) return [{ key: "theory", label: "Theory", max: 80, pass_percent: 33 }, { key: "internal", label: "Internal assessment", max: 20, pass_percent: null }];
  if (grade <= 5) return [
    { key: "written", label: "Written", max: 80, pass_percent: 33 },
    { key: "oral", label: "Oral / Internal", max: 20, pass_percent: null },
  ];
  if (grade <= 8) return [
    { key: "theory", label: "Theory", max: 80, pass_percent: 33 },
    { key: "internal", label: "Internal assessment", max: 20, pass_percent: null },
  ];
  if (grade <= 10) return [
    { key: "theory", label: "Theory", max: 80, pass_percent: 33 },
    { key: "periodic", label: "Periodic assessment", max: 5, pass_percent: null },
    { key: "multiple", label: "Multiple assessment", max: 5, pass_percent: null },
    { key: "portfolio", label: "Portfolio", max: 5, pass_percent: null },
    { key: "enrichment", label: "Subject enrichment", max: 5, pass_percent: null },
  ];
  return XI_XII_PRACTICAL.has(subjectCode)
    ? [{ key: "theory", label: "Theory", max: 70, pass_percent: 33 }, { key: "practical", label: "Practical", max: 30, pass_percent: null }]
    : [{ key: "theory", label: "Theory", max: 80, pass_percent: 33 }, { key: "internal", label: "Internal assessment", max: 20, pass_percent: null }];
}

/** Editable default rule for one subject. Co-scholastic subjects carry no pass threshold. */
export function cbseDefaultSubjectRule(subjectId: string, code: string, grade: number | null, isCoScholastic = false): SubjectRule {
  // Pre-primary and co-scholastic subjects are reported without a pass threshold.
  const noThreshold = isCoScholastic || grade === 0;
  return {
    subject_id: subjectId,
    components: cbseComponentsFor(grade, code),
    pass_percent: noThreshold ? null : 33,
    contributes_to_total: !noThreshold,
  };
}

/** The named starting points offered in the editor for a class. */
export function cbseComponentPresets(grade: number | null): { value: string; label: string; components: ComponentRule[] }[] {
  if (grade === null) return [];
  if (grade === 0) return [
    { value: "preprimary", label: "Pre-primary: 50 written + 50 oral", components: cbseComponentsFor(0, "") },
    { value: "oral", label: "Pre-primary: oral only", components: [{ key: "oral", label: "Oral", max: 100, pass_percent: null }] },
  ];
  if (grade <= 5) return [
    { value: "primary", label: `Class ${grade}: 80 written + 20 oral/internal`, components: cbseComponentsFor(grade, "") },
    { value: "written", label: `Class ${grade}: 100 written`, components: [{ key: "written", label: "Written", max: 100, pass_percent: 33 }] },
  ];
  if (grade <= 8) return [
    { value: "upper", label: `Class ${grade}: 80 theory + 20 internal`, components: [{ key: "theory", label: "Theory", max: 80, pass_percent: 33 }, { key: "internal", label: "Internal assessment", max: 20, pass_percent: null }] },
    { value: "unit_term", label: `Class ${grade}: 20 unit test + 80 term`, components: [{ key: "unit", label: "Unit test", max: 20, pass_percent: null }, { key: "term", label: "Term examination", max: 80, pass_percent: 33 }] },
  ];
  if (grade <= 10) return [
    { value: "secondary", label: `Class ${grade}: 80 theory + four 5-mark internal components`, components: cbseComponentsFor(grade, "") },
    { value: "80/20", label: `Class ${grade}: 80 theory + 20 internal`, components: [{ key: "theory", label: "Theory", max: 80, pass_percent: 33 }, { key: "internal", label: "Internal assessment", max: 20, pass_percent: null }] },
  ];
  return ["80/20", "70/30", "30/70"].map((pattern) => {
    const [theory, other] = pattern.split("/").map(Number);
    return {
      value: pattern,
      label: `Class ${grade}: ${pattern} — confirm the subject curriculum`,
      components: [
        { key: "theory", label: "Theory", max: theory, pass_percent: 33 },
        { key: pattern === "80/20" ? "internal" : "practical", label: pattern === "80/20" ? "Internal assessment" : "Practical", max: other, pass_percent: null },
      ],
    };
  });
}
