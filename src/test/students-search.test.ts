import { describe, expect, it } from "vitest";

import { matchesStudentSearch } from "@/pages/Students";

// A college student typed into the Students list. Phones are stored in whatever
// shape they arrived in — that inconsistency is the whole point of the digit
// comparison.
const student = {
  id: "s1",
  lead_id: null,
  name: "ZZ TEST - Payment Link",
  admission_no: null,
  pre_admission_no: "TEST-PAYLINK-01",
  status: "active",
  archived_at: null,
  phone: "9871763193",
  photo_url: null,
  course_id: "c1",
  batch_id: null,
  session_id: null,
  joining_class: null,
  joining_academic_year: null,
  section: null,
  email: "siddhant@nimt.ac.in",
  father_phone: "+91 98100 11223",
  course_name: "Bachelor of Physiotherapy (BPT)",
  course_code: "BPT",
  course_type: "college",
} as Parameters<typeof matchesStudentSearch>[0];

describe("matchesStudentSearch", () => {
  it("matches the fields the list already searched", () => {
    expect(matchesStudentSearch(student, "zz test")).toBe(true);
    expect(matchesStudentSearch(student, "TEST-PAYLINK-01")).toBe(true);
    expect(matchesStudentSearch(student, "physiotherapy")).toBe(true);
    expect(matchesStudentSearch(student, "")).toBe(true);
    expect(matchesStudentSearch(student, "nobody")).toBe(false);
  });

  it("matches a mobile number however it is typed", () => {
    expect(matchesStudentSearch(student, "9871763193")).toBe(true);
    expect(matchesStudentSearch(student, "98717 63193")).toBe(true);
    expect(matchesStudentSearch(student, "+91 98717 63193")).toBe(true);
    expect(matchesStudentSearch(student, "9871763194")).toBe(false);
  });

  it("matches a parent's number, stored with a country code and spaces", () => {
    expect(matchesStudentSearch(student, "9810011223")).toBe(true);
    expect(matchesStudentSearch(student, "+919810011223")).toBe(true);
  });

  it("matches email", () => {
    expect(matchesStudentSearch(student, "siddhant@nimt.ac.in")).toBe(true);
    expect(matchesStudentSearch(student, "NIMT.AC.IN")).toBe(true);
  });

  it("does not treat a short digit run as a phone search", () => {
    // "01" appears in the PAN, so it must still match by text — but it must not
    // be compared against phone digits, or every number-bearing student matches.
    expect(matchesStudentSearch({ ...student, pre_admission_no: null }, "31")).toBe(false);
  });
});

describe("students search — contact scope", () => {
  // The list renders no phone number, so matching parent phones for a viewer
  // who cannot see contact details turned the search box into an oracle:
  // a subject teacher could recover a parent's number digit by digit from
  // which rows appeared.
  it("does not match parent phone numbers without students:view_contact", () => {
    expect(matchesStudentSearch(student, "9871763193", false)).toBe(false);
    expect(matchesStudentSearch(student, "9810011223", false)).toBe(false);
    expect(matchesStudentSearch(student, "siddhant@nimt.ac.in", false)).toBe(false);
  });

  it("still matches name and admission number without contact access", () => {
    expect(matchesStudentSearch(student, "zz test", false)).toBe(true);
    expect(matchesStudentSearch(student, "TEST-PAYLINK-01", false)).toBe(true);
  });
});
