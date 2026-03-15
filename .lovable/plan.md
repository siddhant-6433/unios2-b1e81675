

## Plan: Academic Details Enhancements, Document Upload Logic, Entrance Exams, PDF Export & Photo Upload

This is a large multi-feature request. I'll break it into prioritized items.

---

### 1. Document Upload — Reflect Optional Graduation/Additional Qualifications

**`DocumentUpload.tsx`**: Update `getRequiredDocs` to check if `academic_details.graduation` exists (even for UG courses) and add graduation marksheet if result is declared. Similarly iterate `additional_qualifications[]` and add marksheet cards for each with declared results.

---

### 2. GNM English Mandatory Fix

The eligibility rule for GNM stores `subject_prerequisites` as `["Any Stream (English Mandatory)"]`. The `parseMandatorySubjects` function already parses this, but the validation in `validateAcademicEligibility` only runs the mandatory check when `mandatorySubjects.length > 0` AND the prereq is "Any Stream" — this path works. Let me verify the actual DB data to confirm the stored value matches the expected parsing pattern. If GNM's prerequisite is stored differently, fix the DB value or parser.

**Action**: Query DB to verify GNM rule, and if needed fix the `parseMandatorySubjects` regex or the stored value. Also ensure the eligibility card displays the English mandatory requirement clearly.

---

### 3. Entrance Exam Section in Academic Details

**`AcademicDetails.tsx`**: Add a new "Entrance Exams" section below academic blocks:
- Auto-populate exam names from `courseRules[courseId].entranceExamName` for each selected course preference (deduplicated)
- For each exam, show a status dropdown: "Yet to Appear", "Result Not Declared", "Result Declared"
- If "Result Declared": show score/rank input
- If "Result Not Declared": show expected result date
- Add "Add Other Exam" button for exams not in the course requirements
- Store in `academic_details.entrance_exams` as `{ exam_name, status, score?, expected_date? }[]`

**`types.ts`**: Add `entrance_exams` to `academic_details` type.

---

### 4. Year Dropdown (1926 to Current Year, Filtered by DOB)

**`AcademicDetails.tsx` / `AcademicBlock`**: Replace the Year text `<input>` with a `<select>` dropdown:
- Range: `max(1926, dobYear)` to current year (2026)
- Years before DOB year are hidden/disabled
- Sorted descending (most recent first) for usability

---

### 5. Board & University Searchable Dropdown from Predefined Lists

**New file: `src/components/apply/boardsAndUniversities.ts`**: Export arrays of common boards (CBSE, ICSE, UP Board, etc.) and universities from the uploaded list.

**`AcademicBlock`**: Replace Board text input with `SubjectTagInput` (single-select mode) with predefined boards + "Add Other" option. Same for University field with predefined university list.

**Backend flagging**: When a custom (non-predefined) board or university is selected, add a flag `"custom_board"` or `"custom_university"` to the application's `flags[]` array so admins can review before issuing offer letters.

---

### 6. PDF Download of Application After Submit

**`ReviewSubmit.tsx`**: After successful submission, show a "Download Application (PDF)" button.

Use browser-side PDF generation (e.g., dynamically import `jspdf` + `html2canvas` or use a simple HTML-to-PDF approach):
- Render a hidden div with the full application summary (logo, all sections, academic details, course preferences, photo)
- Convert to PDF and trigger download
- Include the NIMT/portal logo at top, application ID, submission date

---

### 7. Passport Photo Upload with Background Removal

**`PersonalDetails.tsx` or new `PhotoUpload` component in `DocumentUpload.tsx`**:
- Add a "Passport Photo" upload card with instructions panel:
  - "White background, face clearly visible, bust level"
  - "No caps, sunglasses, or face coverings"
  - "File size: max 2MB, JPG/PNG"
- Upload button + webcam capture option (using `navigator.mediaDevices.getUserMedia`)
- After capture/upload, use an AI model via the Lovable AI gateway to remove background and make it white
- Display preview with the processed photo
- Store in `application-documents` bucket under `{appId}/passport_photo`

For background removal, use the Lovable AI image editing endpoint with `google/gemini-2.5-flash-image` model, sending the uploaded photo with instruction "Remove the background and replace with plain white. Keep only the person visible from bust level up."

---

### Files Changed Summary

| File | Changes |
|---|---|
| `src/components/apply/AcademicDetails.tsx` | Entrance exam section, year dropdown, board/university tag selectors |
| `src/components/apply/DocumentUpload.tsx` | Dynamic docs from optional graduation + additional qualifications, passport photo with webcam + bg removal |
| `src/components/apply/eligibilityRules.ts` | Verify GNM mandatory English parsing works, add entrance_exams to per-course results |
| `src/components/apply/types.ts` | Add `entrance_exams` to academic_details type |
| `src/components/apply/boardsAndUniversities.ts` | New — predefined boards and universities lists |
| `src/components/apply/ReviewSubmit.tsx` | PDF download button post-submission |
| `src/components/apply/PhotoUpload.tsx` | New — passport photo upload with webcam + AI background removal |

### Dependencies
- `jspdf` + `html2canvas` for PDF generation (install via package.json)

