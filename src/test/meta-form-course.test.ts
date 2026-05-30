import { describe, it, expect } from "vitest";
import {
  isCourseField, normalizeMetaCourseValue, extractCourseAnswer, type MetaField,
} from "@/lib/metaFormCourse";

// Regression for "course not coming in Meta leads": the live forms ask the
// course question under names like "which_course_are_you_interested_in?" and
// "which_programme_are_you_interested_in?" with option-key answers
// ("b.sc_nursing", "llb_(3_years)"). The old parser only matched a fixed alias
// list and never normalised underscores, so course_name came back empty.

describe("metaFormCourse — isCourseField", () => {
  it("matches the real Meta course/programme question names", () => {
    expect(isCourseField("which_course_are_you_interested_in?")).toBe(true);
    expect(isCourseField("which_programme_are_you_interested_in?")).toBe(true);
    expect(isCourseField("preferred_course")).toBe(true);
    expect(isCourseField("program")).toBe(true);
  });

  it("does NOT treat stream/qualification as a course", () => {
    expect(isCourseField("what_was_your_stream_in_12th?")).toBe(false);
    expect(isCourseField("what_is_your_highest_qualification?")).toBe(false);
  });

  it("does NOT match unrelated fields (school class/grade are handled by form mapping)", () => {
    expect(isCourseField("which_class_are_you_looking_admission_for?")).toBe(false);
    expect(isCourseField("which_grade_are_you_seeking_admission_for?")).toBe(false);
    expect(isCourseField("full_name")).toBe(false);
    expect(isCourseField("city")).toBe(false);
  });
});

describe("metaFormCourse — normalizeMetaCourseValue", () => {
  it("lowercases and turns underscores into spaces so values match course names", () => {
    expect(normalizeMetaCourseValue("b.sc_nursing")).toBe("b.sc nursing");
    expect(normalizeMetaCourseValue("BPT")).toBe("bpt");
    expect(normalizeMetaCourseValue("ba_llb_(5_years)")).toBe("ba llb (5 years)");
  });
});

describe("metaFormCourse — extractCourseAnswer", () => {
  const fd = (name: string, value: string): MetaField => ({ name, values: [value] });

  it("pulls the normalised answer from the Health form", () => {
    const fieldData = [
      fd("full_name", "Richa Mahajan"),
      fd("which_course_are_you_interested_in?", "b.sc_nursing"),
      fd("what_was_your_stream_in_12th?", "pcb"),
    ];
    expect(extractCourseAnswer(fieldData)).toBe("b.sc nursing");
  });

  it("pulls the programme answer from the Law form", () => {
    const fieldData = [
      fd("email", "x@y.com"),
      fd("which_programme_are_you_interested_in?", "llb_(3_years)"),
    ];
    expect(extractCourseAnswer(fieldData)).toBe("llb (3 years)");
  });

  it("returns '' for a school form with no course question", () => {
    const fieldData = [
      fd("full_name", "Deepak"),
      fd("which_class_are_you_looking_admission_for?", "3"),
    ];
    expect(extractCourseAnswer(fieldData)).toBe("");
  });

  it("ignores the 12th-stream question (not a course)", () => {
    const fieldData = [fd("what_was_your_stream_in_12th?", "arts")];
    expect(extractCourseAnswer(fieldData)).toBe("");
  });

  it("is safe on empty / malformed input", () => {
    expect(extractCourseAnswer([])).toBe("");
    expect(extractCourseAnswer(undefined as any)).toBe("");
    expect(extractCourseAnswer([{ name: "course" }])).toBe(""); // no values
  });
});
