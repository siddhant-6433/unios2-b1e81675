import { describe, expect, it } from "vitest";
import {
  CBSE_GRADE_BANDS,
  CBSE_SOURCE_URL,
  cbseComponentPresets,
  cbseComponentsFor,
  cbseDefaultSubjectRule,
  cbseSubjectsForGrade,
} from "@/lib/cbseDefaults";

const total = (components: { max: number }[]) => components.reduce((sum, component) => sum + component.max, 0);

describe("CBSE defaults", () => {
  it("covers zero on a distinct eight-point scale", () => {
    const mins = CBSE_GRADE_BANDS.map(b => b.min);
    expect(Math.min(...mins)).toBe(0);
    expect(new Set(mins).size).toBe(mins.length);
    expect(CBSE_GRADE_BANDS.find(b => b.min === 91)?.grade).toBe("A1");
    expect(CBSE_SOURCE_URL).toContain("cbseacademic.nic.in");
  });

  it("returns the subject set for a class and nothing for pre-primary or beyond XII", () => {
    expect(cbseSubjectsForGrade(10).map(s => s.code)).toEqual(["ENG", "HIN", "MAT", "SCI", "SST"]);
    expect(cbseSubjectsForGrade(2).map(s => s.code)).toContain("EVS");
    expect(cbseSubjectsForGrade(12).find(s => s.code === "PHY")?.is_elective).toBe(true);
    expect(cbseSubjectsForGrade(0).map(s => s.code)).toContain("HIN");
    expect(cbseSubjectsForGrade(null)).toEqual([]);
    expect(cbseSubjectsForGrade(13)).toEqual([]);
  });

  it("sums to 100 per subject and splits science practicals for XI–XII", () => {
    for (const grade of [3, 7, 10, 11, 12]) expect(total(cbseComponentsFor(grade, "ENG"))).toBe(100);
    expect(cbseComponentsFor(12, "PHY").map(c => `${c.label}:${c.max}`)).toEqual(["Theory:70", "Practical:30"]);
    expect(cbseComponentsFor(12, "ACC").map(c => `${c.label}:${c.max}`)).toEqual(["Theory:80", "Internal assessment:20"]);
    expect(cbseComponentsFor(10, "MAT")).toHaveLength(5);
  });

  it("keeps co-scholastic subjects out of the aggregate with no pass threshold", () => {
    const coScholastic = cbseDefaultSubjectRule("id", "ART", 6, true);
    expect(coScholastic.pass_percent).toBeNull();
    expect(coScholastic.contributes_to_total).toBe(false);
    const scholastic = cbseDefaultSubjectRule("id", "MAT", 6, false);
    expect(scholastic.pass_percent).toBe(33);
  });

  it("offers editable presets for every class band", () => {
    expect(cbseComponentPresets(2).length).toBeGreaterThan(0);
    expect(cbseComponentPresets(7).length).toBeGreaterThan(0);
    expect(cbseComponentPresets(10).map(p => p.value)).toContain("secondary");
    expect(cbseComponentPresets(12).map(p => p.value)).toEqual(["80/20", "70/30", "30/70"]);
    expect(cbseComponentPresets(0).map(p => p.value)).toContain("preprimary");
  });
});
