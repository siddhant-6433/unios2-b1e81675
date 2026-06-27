import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const documentUpload = readFileSync("src/components/apply/DocumentUpload.tsx", "utf8");
const applyPortalUploadDoc = readFileSync("supabase/functions/apply-portal-upload-doc/index.ts", "utf8");
const applicationFormPdf = readFileSync("supabase/functions/generate-application-form/index.ts", "utf8");

describe("parent Aadhaar document slots", () => {
  it("offers separate father, mother, and guardian Aadhaar uploads", () => {
    expect(documentUpload).toContain("key: 'father_aadhaar'");
    expect(documentUpload).toContain("key: 'mother_aadhaar'");
    expect(documentUpload).toContain("key: 'guardian_aadhaar'");
    expect(documentUpload).toContain("Father Aadhaar Card");
    expect(documentUpload).toContain("Mother Aadhaar Card");
    expect(documentUpload).toContain("Guardian Aadhaar Card");
    expect(documentUpload).not.toContain("key: 'parent_aadhaar'");
  });

  it("allows the new upload keys while preserving legacy parent Aadhaar", () => {
    expect(applyPortalUploadDoc).toContain('"father_aadhaar"');
    expect(applyPortalUploadDoc).toContain('"mother_aadhaar"');
    expect(applyPortalUploadDoc).toContain('"guardian_aadhaar"');
    expect(applyPortalUploadDoc).toContain('"parent_aadhaar"');
  });

  it("renders friendly names for new and legacy Aadhaar document keys", () => {
    expect(applicationFormPdf).toContain('father_aadhaar:         "Father Aadhaar Card"');
    expect(applicationFormPdf).toContain('mother_aadhaar:         "Mother Aadhaar Card"');
    expect(applicationFormPdf).toContain('guardian_aadhaar:       "Guardian Aadhaar Card"');
    expect(applicationFormPdf).toContain('parent_aadhaar:         "Parent / Guardian Aadhaar"');
  });
});
