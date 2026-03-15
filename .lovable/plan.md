

## Plan: Enhanced Academic Validation, Per-Course Eligibility, Document Upload Logic & More

### Overview

Seven interconnected improvements to the academic details step, eligibility validation, and document upload logic.

---

### 1. Per-Course Eligibility Display at Top of Academic Details

**Current**: Merges all course rules into one combined rule, shows a single validation result.

**New**: At the top of Academic Details, show a **per-course eligibility card** for each selected course preference, like:

```text
┌─────────────────────────────────────────────┐
│ Preference 1: B.Sc Nursing — Greater Noida  │
│  ✅ Age OK  ❌ PCB Required  ⚠ 45% min     │
├─────────────────────────────────────────────┤
│ Preference 2: GNM — Greater Noida           │
│  ✅ Age OK  ✅ English ✓  ✅ 40% min        │
└─────────────────────────────────────────────┘
```

Each course runs its own `validateAcademicEligibility` + `validateDobEligibility` independently, showing pass/fail per rule. Blocking errors only apply if **ALL** courses fail (i.e., applicant is ineligible for every preference). If at least one course passes, they can proceed.

**Files**: `AcademicDetails.tsx`, `eligibilityRules.ts`

---

### 2. Subject Validation — Always Show & Block if Empty

**Current**: Subject input only appears when `hasSubjectPrereqs` is true.

**New**:
- Always show the Class 12 subject tag selector (for non-school courses)
- If any selected course has subject prerequisites and subjects are empty → blocking error
- Parse GNM-style "Any Stream (English Mandatory)" to extract mandatory individual subjects and validate them separately
- Empty subjects with prerequisites = `type: 'error'` (not warning)

**Files**: `AcademicDetails.tsx`, `eligibilityRules.ts`

---

### 3. Academic Year Validations

Add `validateAcademicYears(academicDetails, sessionYear)` to `eligibilityRules.ts`:

- Class 10 Year ≤ sessionYear − 2 (≤ 2024 for 2026-27)
- Class 12 Year ≤ sessionYear (≤ 2026)
- Class 12 Year − Class 10 Year ≥ 2
- Graduation Year ≤ sessionYear (for PG)
- All return `type: 'error'`

Display inline next to Year fields in `AcademicBlock`.

**Files**: `eligibilityRules.ts`, `AcademicDetails.tsx`

---

### 4. Document Upload Linked to Result Status

Update `getRequiredDocs` in `DocumentUpload.tsx` to accept `academic_details`:

- `class_10.result_status === 'not_declared'` → hide Class 10 marksheet
- `class_12.result_status === 'not_declared'` → hide Class 12 marksheet  
- `graduation.result_status === 'not_declared'` → hide Graduation marksheet

Pass `data.academic_details` from parent into `DocumentUpload`.

**Files**: `DocumentUpload.tsx`

---

### 5. Optional Additional Qualifications

- **UG courses**: Add collapsible "Add Graduation Details (Optional)" below Class 12 — allows explaining gap years. Not validated for eligibility.
- **PG / LLB courses**: Allow adding multiple graduation entries via "Add Another Qualification" button. Store as `academic_details.additional_qualifications[]`.
- **LLB special case**: If any entered graduation/additional qualification meets the marks threshold, applicant is eligible.

**Files**: `AcademicDetails.tsx`, `types.ts` (add `additional_qualifications` to academic_details type), `eligibilityRules.ts` (LLB multi-qualification check)

---

### 6. Submission Blocking Consolidation

Block "Save & Continue" if ANY of:
- Required subjects missing (empty) when course has prerequisites
- Subject prerequisites not met for ALL courses
- Year validations fail (Class 10/12 year limits, gap < 2)
- Marks below minimum for ALL courses

All flow through existing `hasBlockingErrors` check since they return `type: 'error'`.

---

### Files Changed Summary

| File | Changes |
|---|---|
| `src/components/apply/eligibilityRules.ts` | Add `validateAcademicYears()`, parse "English Mandatory" from GNM prereqs, add per-course validation helper, LLB multi-qualification check |
| `src/components/apply/AcademicDetails.tsx` | Per-course eligibility cards at top, always show subjects, year validation inline, optional graduation for UG, multiple qualifications for PG, add "Add Another Qualification" |
| `src/components/apply/DocumentUpload.tsx` | Accept `academic_details`, conditionally hide marksheets when result not declared |
| `src/components/apply/types.ts` | Add `additional_qualifications` array to `academic_details` type |

