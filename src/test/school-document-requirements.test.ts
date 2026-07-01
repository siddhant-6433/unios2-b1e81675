import { describe, expect, it } from "vitest";
import { getRequiredDocs } from "@/components/apply/DocumentUpload";

function schoolDoc(courseName: string, key: string) {
  return getRequiredDocs("school", {}, [{ course_name: courseName }]).find((doc) => doc.key === key);
}

describe("school document requirements", () => {
  it("requires birth certificate for Nursery admissions", () => {
    expect(schoolDoc("Nursery", "birth_certificate")?.required).toBe(true);
    expect(schoolDoc("Pre-Nursery", "birth_certificate")?.required).toBe(true);
  });

  it("keeps birth certificate optional for non-Nursery school classes", () => {
    expect(schoolDoc("LKG", "birth_certificate")?.required).toBe(false);
    expect(schoolDoc("Class 1", "birth_certificate")?.required).toBe(false);
    expect(schoolDoc("Grade VIII", "birth_certificate")?.required).toBe(false);
  });

  it("keeps transfer certificate optional for school admissions", () => {
    expect(schoolDoc("Nursery", "transfer_certificate")?.required).toBe(false);
    expect(schoolDoc("Class 1", "transfer_certificate")?.required).toBe(false);
    expect(schoolDoc("Grade VIII", "transfer_certificate")?.required).toBe(false);
  });
});
