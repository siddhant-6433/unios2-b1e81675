import { describe, expect, it } from "vitest";
import {
  beaconGradeFromCourseCode,
  CBSE_CATEGORY_LABELS,
  CBSE_EXAM_STATUS_LABELS,
  evaluatePolicyPaper,
  examTypeAllowedForGrade,
  gradeForPercent,
  isBeaconCourseCode,
  isFeeClear,
  remarksAreComplete,
  roundMarks,
  type CbseMark,
  type PolicyRules,
  type SubjectRule,
} from "@/lib/cbseExams";

const subjectRule: SubjectRule = {
  subject_id: "math",
  components: [
    { key: "theory", label: "Theory", max: 80, pass_percent: 33 },
    { key: "internal", label: "Internal", max: 20, pass_percent: null },
  ],
  pass_percent: 33,
};

const policy: PolicyRules = {
  subjects: [subjectRule],
  grade_bands: [
    { min: 91, grade: "A1" },
    { min: 81, grade: "A2" },
    { min: 71, grade: "B1" },
    { min: 61, grade: "B2" },
    { min: 51, grade: "C1" },
    { min: 41, grade: "C2" },
    { min: 33, grade: "D" },
    { min: 0, grade: "E" },
  ],
  rounding: 2,
  absent_treatment: "zero",
  exempt_treatment: "exclude",
  additional_subject_treatment: "all_applicable",
  annual_weights: [],
  confirmed: true,
  source_url: "https://cbseacademic.nic.in/curriculum_2027.html",
};

const present = (scores: CbseMark["scores"]): CbseMark => ({ status: "present", scores, remarks: null });

describe("Beacon course identity", () => {
  it("recognises Avantika and Arthala course codes", () => {
    expect(isBeaconCourseCode("BSAV-G10")).toBe(true);
    expect(isBeaconCourseCode("BSA-G8")).toBe(true);
    expect(isBeaconCourseCode("BSAV-NUR")).toBe(true);
    expect(isBeaconCourseCode("MES-PYP1")).toBe(false);
    expect(isBeaconCourseCode("BBA")).toBe(false);
    expect(isBeaconCourseCode(null)).toBe(false);
  });

  it("parses the grade and rejects out-of-range classes", () => {
    expect(beaconGradeFromCourseCode("BSAV-G10")).toBe(10);
    expect(beaconGradeFromCourseCode("BSAV-G12")).toBe(12);
    expect(beaconGradeFromCourseCode("BSA-G1")).toBe(1);
    expect(beaconGradeFromCourseCode("BSAV-G13")).toBeNull();
    expect(beaconGradeFromCourseCode("BSAV-NUR")).toBe(0);
    expect(beaconGradeFromCourseCode("BSAV-LKG")).toBe(0);
  });
});

describe("Exam type rules", () => {
  it("allows Pre-Boards only for Classes X and XII", () => {
    expect(examTypeAllowedForGrade("pre_board", 10)).toBe(true);
    expect(examTypeAllowedForGrade("pre_board", 12)).toBe(true);
    expect(examTypeAllowedForGrade("pre_board", 9)).toBe(false);
    expect(examTypeAllowedForGrade("unit_test", 8)).toBe(true);
    expect(examTypeAllowedForGrade("half_yearly", 1)).toBe(true);
    expect(examTypeAllowedForGrade("annual", 12)).toBe(true);
    expect(examTypeAllowedForGrade("final", 0)).toBe(true);
    expect(examTypeAllowedForGrade("pre_board", 0)).toBe(false);
  });

  it("labels every category and status", () => {
    expect(CBSE_CATEGORY_LABELS.pre_board).toBe("Pre-Board");
    expect(CBSE_CATEGORY_LABELS.annual).toBe("Annual Report");
    expect(CBSE_EXAM_STATUS_LABELS.principal_review).toBe("Academic review");
    expect(CBSE_EXAM_STATUS_LABELS.released).toBe("Released");
  });
});

describe("Grading and rounding", () => {
  it("maps a percentage onto the configured grade bands", () => {
    expect(gradeForPercent(91, policy.grade_bands)).toBe("A1");
    expect(gradeForPercent(90.99, policy.grade_bands)).toBe("A2");
    expect(gradeForPercent(33, policy.grade_bands)).toBe("D");
    expect(gradeForPercent(32.9, policy.grade_bands)).toBe("E");
    expect(gradeForPercent(null, policy.grade_bands)).toBeNull();
  });

  it("rounds to the policy's decimal places", () => {
    expect(roundMarks(83.456, 2)).toBe(83.46);
    expect(roundMarks(83.456, 0)).toBe(83);
    expect(roundMarks(83.456, 1)).toBe(83.5);
  });
});

describe("Policy paper evaluation (missing is never zero)", () => {
  it("returns an incomplete paper when no mark is recorded", () => {
    const result = evaluatePolicyPaper(subjectRule, undefined, policy);
    expect(result.complete).toBe(false);
    expect(result.obtained).toBeNull();
    expect(result.max).toBe(100);
  });

  it("evaluates a complete present paper", () => {
    const result = evaluatePolicyPaper(subjectRule, present({ theory: 66, internal: 18 }), policy);
    expect(result.complete).toBe(true);
    expect(result.obtained).toBe(84);
    expect(result.percentage).toBe(84);
    expect(result.grade).toBe("A2");
    expect(result.passed).toBe(true);
  });

  it("fails the paper when a component is below its pass percentage", () => {
    const result = evaluatePolicyPaper(subjectRule, present({ theory: 20, internal: 20 }), policy);
    expect(result.obtained).toBe(40);
    expect(result.passed).toBe(false);
  });

  it("fails the subject when the aggregate is below its pass threshold", () => {
    const result = evaluatePolicyPaper(subjectRule, present({ theory: 30, internal: 0 }), policy);
    expect(result.percentage).toBe(30);
    expect(result.passed).toBe(false);
  });

  it("rejects missing, out-of-range or unknown component scores", () => {
    expect(evaluatePolicyPaper(subjectRule, present({ theory: 66 }), policy).complete).toBe(false);
    expect(evaluatePolicyPaper(subjectRule, present({ theory: 90, internal: 10 }), policy).complete).toBe(false);
    expect(evaluatePolicyPaper(subjectRule, present({ theory: -1, internal: 10 }), policy).complete).toBe(false);
  });

  it("treats an explicit zero as a scored zero, not a missing mark", () => {
    const result = evaluatePolicyPaper(subjectRule, present({ theory: 0, internal: 0 }), policy);
    expect(result.complete).toBe(true);
    expect(result.obtained).toBe(0);
    expect(result.passed).toBe(false);
  });

  it("counts absence as zero when the policy says so", () => {
    const result = evaluatePolicyPaper(subjectRule, { status: "absent", scores: {}, remarks: null }, policy);
    expect(result.complete).toBe(true);
    expect(result.obtained).toBe(0);
    expect(result.passed).toBe(false);
  });

  it("excludes absence and exemption from the aggregate when configured", () => {
    const excludeAbsent: PolicyRules = { ...policy, absent_treatment: "exclude" };
    const absent = evaluatePolicyPaper(subjectRule, { status: "absent", scores: {}, remarks: null }, excludeAbsent);
    expect(absent.complete).toBe(true);
    expect(absent.obtained).toBeNull();
    expect(absent.max).toBe(0);
    const exempt = evaluatePolicyPaper(subjectRule, { status: "exempt", scores: {}, remarks: null }, policy);
    expect(exempt.complete).toBe(true);
    expect(exempt.obtained).toBeNull();
    expect(exempt.passed).toBeNull();
  });
});

describe("Fee clearance", () => {
  it("is clear only when nothing is due", () => {
    expect(isFeeClear(0)).toBe(true);
    expect(isFeeClear(-10)).toBe(true);
    expect(isFeeClear(1)).toBe(false);
    expect(isFeeClear(null)).toBe(false);
    expect(isFeeClear(Number.NaN)).toBe(false);
  });
});

describe("Remarks", () => {
  it("requires a non-blank remark", () => {
    expect(remarksAreComplete("")).toBe(false);
    expect(remarksAreComplete("   ")).toBe(false);
    expect(remarksAreComplete(null)).toBe(false);
    expect(remarksAreComplete("Concession granted for sibling")).toBe(true);
  });
});
