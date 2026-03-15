

## Plan: Add Individual Subject Marks Capture for Eligibility Validation

### Problem
GNM requires 40% in English individually, but the form only captures overall Class 12 marks — there's no way to enter or validate marks per subject.

### Solution
Add a new concept of **"subject-wise minimum marks"** to the eligibility system. When a course rule specifies minimum marks for individual subjects (e.g., English 40%), the Academic Details form will show additional input fields for those specific subjects' marks, and validation will check them independently.

---

### 1. Database: Add `subject_min_marks` column to `eligibility_rules`

Add a JSONB column `subject_min_marks` (e.g., `{"English": 40}`) to store per-subject minimum marks requirements.

```sql
ALTER TABLE eligibility_rules ADD COLUMN subject_min_marks jsonb DEFAULT NULL;
```

Update GNM's rule via insert tool: `UPDATE eligibility_rules SET subject_min_marks = '{"English": 40}' WHERE course_id = (GNM course ID);`

### 2. Eligibility Rule Types (`eligibilityRules.ts`)

- Add `subjectMinMarks?: Record<string, number>` to `EligibilityRule` interface
- Add `subject_min_marks` to `EligibilityRuleDB` and `dbRuleToEligibility`
- Add validation in `validateAcademicEligibility`: check `academic_details.class_12.subject_marks[subject]` against each required minimum

### 3. Academic Details Form (`AcademicDetails.tsx`)

- When any selected course has `subjectMinMarks`, show additional "Subject Marks" inputs below the Class 12 subjects selector
- Only show inputs for the mandatory subjects (deduplicated across all course preferences)
- Store as `academic_details.class_12.subject_marks: { English: "45", ... }`

### 4. Admin Dialog (`EligibilityRuleDialog.tsx`)

- Add a section to configure subject-wise minimum marks (add subject name + min % pairs)

### Files Changed

| File | Changes |
|---|---|
| `eligibility_rules` table | Add `subject_min_marks` JSONB column |
| `src/components/apply/eligibilityRules.ts` | Add `subjectMinMarks` to interfaces, add per-subject validation |
| `src/components/apply/AcademicDetails.tsx` | Show subject marks inputs when required by course rules |
| `src/components/admin/EligibilityRuleDialog.tsx` | Add subject-wise marks config UI |

