import { readFileSync } from "node:fs";
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  headerSearchCourseFromRelation,
  headerSearchCoursesFromSelections,
  headerSearchApplicationResult,
  headerSearchIdentity,
  headerSearchLeadResult,
  headerSearchStudentResult,
  HeaderSearchHit,
} from "@/components/layout/HeaderSearch";

describe("headerSearchIdentity", () => {
  it("shows AN and drops PAN when both exist", () => {
    expect(headerSearchIdentity({
      admission_no: "AN-283F4F18",
      pre_admission_no: "PAN-E5B25972",
    })).toEqual({ identifier: "AN-283F4F18", identifierLabel: "AN" });
  });

  it("shows PAN only when there is no AN", () => {
    expect(headerSearchIdentity({
      pre_admission_no: "PAN-E5B25972",
    })).toEqual({ identifier: "PAN-E5B25972", identifierLabel: "PAN" });
  });
});

describe("HeaderSearchHit", () => {
  it("keeps the full name visible and does not render PAN beside an AN", () => {
    const identity = headerSearchIdentity({
      admission_no: "AN-283F4F18",
      pre_admission_no: "PAN-E5B25972",
    });
    render(
      <HeaderSearchHit
        result={{
          type: "student",
          id: "s1",
          name: "Pawan Yadav",
          phone: "+9190982470240",
          ...identity,
          status: "active",
        }}
        onClick={() => {}}
      />,
    );

    const name = screen.getByText("Pawan Yadav");
    expect(within(name.parentElement!).queryByText(/AN:/)).toBeNull();
    expect(name).not.toHaveClass("truncate");

    expect(screen.getByText("AN: AN-283F4F18")).toBeInTheDocument();
    expect(screen.queryByText(/PAN:/)).toBeNull();
    expect(screen.getByText("Student")).toBeInTheDocument();
  });

  it("masks the phone as first3****last3 for staff viewers", () => {
    render(
      <HeaderSearchHit
        result={{
          type: "lead",
          id: "l1",
          name: "Amit Kumar",
          phone: "9812345892",
        }}
        onClick={() => {}}
      />,
    );
    expect(screen.getByText(/981\*\*\*\*892/)).toBeInTheDocument();
    expect(screen.queryByText("9812345892")).toBeNull();
  });

  it("shows the candidate's course when available", () => {
    render(
      <HeaderSearchHit
        result={{
          type: "student",
          id: "s1",
          name: "Pawan Yadav",
          phone: "9812345892",
          courseName: "Bachelor of Science in Nursing",
        }}
        onClick={() => {}}
      />,
    );

    expect(screen.getByText("Bachelor of Science in Nursing")).toBeInTheDocument();
  });

  it("omits the course line when no course is available", () => {
    render(
      <HeaderSearchHit
        result={{ type: "lead", id: "l1", name: "Amit Kumar", phone: "9812345892" }}
        onClick={() => {}}
      />,
    );

    expect(screen.queryByText("Bachelor of Science in Nursing")).toBeNull();
    expect(screen.getByText(/981\*\*\*\*892/)).toBeInTheDocument();
  });
});

describe("header search course mapping", () => {
  const source = readFileSync("src/components/layout/HeaderSearch.tsx", "utf8");

  it("reads a course name from lead and student course relations", () => {
    expect(headerSearchCourseFromRelation({ name: "  B.Sc Nursing  " })).toBe("B.Sc Nursing");
    expect(headerSearchCourseFromRelation(null)).toBeUndefined();
    expect(headerSearchCourseFromRelation({ name: "  " })).toBeUndefined();
  });

  it("shows distinct selected application course names and omits empty selections", () => {
    expect(headerSearchCoursesFromSelections([
      { course_name: " B.Sc Nursing " },
      { course_name: "B.Sc Nursing" },
      { course_name: "GNM" },
      { course_name: 42 },
    ])).toBe("B.Sc Nursing, GNM");
    expect(headerSearchCoursesFromSelections([])).toBeUndefined();
    expect(headerSearchCoursesFromSelections(null)).toBeUndefined();
  });

  it("maps course names into lead, student, and application search results", () => {
    expect(headerSearchLeadResult({ id: "l1", name: "Amit Kumar", phone: "9812345892", courses: { name: "B.Sc Nursing" } }).courseName)
      .toBe("B.Sc Nursing");
    expect(headerSearchStudentResult({ id: "s1", name: "Pawan Yadav", courses: { name: "GNM" } }).courseName)
      .toBe("GNM");
    expect(headerSearchApplicationResult({
      id: "a1",
      course_selections: [{ course_name: "MBA" }, { course_name: "BBA" }],
    }).courseName).toBe("MBA, BBA");
  });

  it("selects course data for leads, students, and applications", () => {
    expect(source).toContain("courses:course_id(name), counsellor_profile:counsellor_id(display_name)");
    expect(source).toContain("photo_url, lead_id, courses:course_id(name)");
    expect(source).toContain("status, course_selections");
  });
});
