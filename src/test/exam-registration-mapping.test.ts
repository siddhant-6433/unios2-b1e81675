import { describe, expect, it } from "vitest";
import {
  examCodeForCourse,
  examCodeForApplication,
  bedExamForCampus,
  isBscNursingCourseName,
  isGnmCourseName,
  isDPharmaCourseName,
  isBedCourseName,
  EXAM_DISPLAY_NAMES,
  examStatusLabel,
} from "@/lib/examRegistration";

describe("examCodeForCourse", () => {
  it("maps each course to its entrance exam", () => {
    expect(examCodeForCourse("Diploma in Elementary Education (D.El.Ed)")).toBe("updeled");
    expect(examCodeForCourse("Bachelor of Physiotherapy (BPT)")).toBe("cahet");
    expect(examCodeForCourse("B.Sc in Radiology & Imaging Technology (BMRIT)")).toBe("cahet");
    expect(examCodeForCourse("Bachelor of Science in Nursing (B.Sc Nursing)")).toBe("cnet");
    expect(examCodeForCourse("Diploma in Pharmacy (D.Pharma)")).toBe("jeecup");
    expect(examCodeForCourse("General Nursing & Midwifery (GNM)")).toBe("upget");
  });

  it("splits B.Ed by campus", () => {
    expect(examCodeForCourse("Bachelor of Education (B.Ed)", "Kotputli Jaipur Campus")).toBe("ptet");
    expect(examCodeForCourse("Bachelor of Education (B.Ed)", "Greater Noida Campus")).toBe("jee_bed");
    expect(examCodeForCourse("Bachelor of Education (B.Ed)", "Ghaziabad Campus 2 (Avantika)")).toBe("jee_bed");
    // No campus → defaults to JEE B.Ed (the majority case)
    expect(examCodeForCourse("Bachelor of Education (B.Ed)")).toBe("jee_bed");
  });

  it("does not confuse GNM with B.Sc Nursing", () => {
    expect(isGnmCourseName("General Nursing & Midwifery (GNM)")).toBe(true);
    expect(isBscNursingCourseName("General Nursing & Midwifery (GNM)")).toBe(false);
    expect(isBscNursingCourseName("Bachelor of Science in Nursing (B.Sc Nursing)")).toBe(true);
  });

  it("does not confuse D.El.Ed with B.Ed", () => {
    expect(isBedCourseName("Diploma in Elementary Education (D.El.Ed)")).toBe(false);
    expect(isBedCourseName("Bachelor of Education (B.Ed)")).toBe(true);
    expect(examCodeForCourse("Diploma in Elementary Education (D.El.Ed)", "Kotputli Jaipur Campus")).toBe("updeled");
  });

  it("matches D.Pharma but leaves other pharmacy degrees alone", () => {
    expect(isDPharmaCourseName("Diploma in Pharmacy (D.Pharma)")).toBe(true);
    expect(isDPharmaCourseName("Bachelor of Pharmacy (B.Pharma)")).toBe(false);
  });

  it("returns null for courses with no registration gate", () => {
    expect(examCodeForCourse("Bachelor of Business Administration (BBA)")).toBeNull();
    expect(examCodeForCourse("")).toBeNull();
    expect(examCodeForCourse(null)).toBeNull();
  });

  it("bedExamForCampus is case-insensitive on Kotputli", () => {
    expect(bedExamForCampus("kotputli jaipur campus")).toBe("ptet");
    expect(bedExamForCampus("Greater Noida Campus")).toBe("jee_bed");
    expect(bedExamForCampus(null)).toBe("jee_bed");
  });
});

describe("examCodeForApplication", () => {
  it("derives the exam from the first mapping course selection", () => {
    expect(
      examCodeForApplication({
        course_selections: [
          { course_name: "Bachelor of Business Administration (BBA)", campus_name: "X" },
          { course_name: "Bachelor of Education (B.Ed)", campus_name: "Kotputli Jaipur Campus" },
        ],
      }),
    ).toBe("ptet");
    expect(examCodeForApplication({ course_selections: [] })).toBeNull();
    expect(examCodeForApplication(null)).toBeNull();
  });
});

describe("presentation helpers", () => {
  it("has a candidate-facing display name for every exam", () => {
    expect(EXAM_DISPLAY_NAMES.cahet).toContain("ABVMU");
    expect(EXAM_DISPLAY_NAMES.cnet).toContain("BSc Nursing");
    expect(EXAM_DISPLAY_NAMES.updeled).toBe("UPDELED Counselling");
  });

  it("labels registration statuses", () => {
    expect(examStatusLabel("registered")).toBe("Registered");
    expect(examStatusLabel("registered_no_number")).toBe("Registered · no number");
    expect(examStatusLabel("not_registered")).toBe("Not Registered");
    expect(examStatusLabel("unknown")).toBe("Unknown");
  });
});
