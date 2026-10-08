import { describe, expect, it } from "vitest";
import {
  findMiraiSection, MIRAI_STEPS, miraiAdmissionRequestPayload, miraiEnquiryPayload, miraiGroupIsComplete, validateMiraiEnquiry,
} from "@/components/apply/miraiJourney";

describe("Mirai application journey", () => {
  it("groups the existing application sections into five ordered stages", () => {
    expect(MIRAI_STEPS.map(step => step.label)).toEqual([
      "Child & grade", "Family", "Learning journey", "Documents & payment", "Review",
    ]);
    expect(MIRAI_STEPS.flatMap(step => step.sectionKeys)).toEqual([
      "personal", "parents", "siblings", "questionnaire", "academic", "payment", "documents", "review",
    ]);
  });

  it("resumes on the first unfinished section and maps explicit edit access", () => {
    const completed = { personal: true, parents: true, siblings: true };
    expect(findMiraiSection(completed)).toEqual({ stepIndex: 2, sectionKey: "questionnaire" });
    expect(findMiraiSection(completed, "documents")).toEqual({ stepIndex: 3, sectionKey: "documents" });
  });

  it("marks a grouped stage complete only after all of its stored sections are complete", () => {
    expect(miraiGroupIsComplete(MIRAI_STEPS[1], { parents: true, siblings: false })).toBe(false);
    expect(miraiGroupIsComplete(MIRAI_STEPS[1], { parents: true, siblings: true })).toBe(true);
  });
});

describe("Mirai enquiry validation and mapping", () => {
  const values = {
    parentName: "  Asha Rao ", email: "asha@example.in", phone: "+919876543210", childName: "Mira Rao",
    age: "6", currentSchool: "Greenfield School", grade: "course-id", academicYear: "2026–27",
    discoverySource: "Social media", consent: true,
  };

  it("accepts a complete enquiry and flags invalid age, email, grade and consent", () => {
    expect(Object.values(validateMiraiEnquiry(values, true)).every(Boolean)).toBe(true);
    const invalid = validateMiraiEnquiry({ ...values, age: "19", email: "bad", grade: "missing", consent: false }, false);
    expect(invalid.age).toBe(false);
    expect(invalid.email).toBe(false);
    expect(invalid.grade).toBe(false);
    expect(invalid.consent).toBe(false);
  });

  it("maps the parent as lead contact and preserves child, year, grade, consent and attribution", () => {
    expect(miraiEnquiryPayload(values, { name: "PYP 1", code: "MES-PYP1" }, { utm_source: "school-site" })).toEqual({
      parent_name: "Asha Rao", mobile_number: "+919876543210", email: "asha@example.in", child_name: "Mira Rao",
      child_age: 6, current_school: "Greenfield School", grade: "PYP 1", course_code: "MES-PYP1",
      academic_year: "2026–27", discovery_source: "Social media", contact_consent: true, whatsapp_consent: true,
      website: "", utm_source: "school-site",
    });
  });

  it("submits call and campus-tour requests against the captured enquiry lead", () => {
    expect(miraiAdmissionRequestPayload("lead-123", "call", "Asha Rao", "Mira Rao")).toEqual({
      lead_id: "lead-123", request_type: "call", parent_name: "Asha Rao", child_name: "Mira Rao",
    });
    expect(miraiAdmissionRequestPayload("lead-123", "campus_tour", "Asha Rao", "Mira Rao").request_type).toBe("campus_tour");
  });
});
