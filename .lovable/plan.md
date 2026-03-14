

## Plan: Phone Input Standardization + Academic Eligibility Validations

### Part 1: Replace all phone fields with PhoneInput component (with flag + ISD code)

Currently, several forms use plain `<input>` for phone fields instead of the `PhoneInput` component. These need to be replaced:

**Files to update:**

1. **`src/components/apply/PersonalDetails.tsx`** (line 56)
   - The disabled phone field uses a plain `<input>`. Replace with `<PhoneInput value={data.phone} onChange={() => {}} disabled />`.
   - Need to add `disabled` prop support to `PhoneInput`.

2. **`src/components/apply/ParentDetails.tsx`** (line 42)
   - Father, Mother, Guardian phone fields all use plain `<input>`. Replace each with `<PhoneInput>`.

3. **`src/components/ui/phone-input.tsx`**
   - Add `disabled` prop support so it works for read-only display (PersonalDetails phone field).
   - When disabled, show flag + country code + formatted number but prevent interaction.

### Part 2: Academic Eligibility Validations (marks, DOB)

Currently there is **no marks/percentage validation** on the Academic Details step. The system needs to validate:

- **DOB validation**: Already active for school portals via `ageValidation.ts`. For non-school programs, DOB entered in Personal Details should be validated (e.g., minimum 17 years for UG).
- **12th marks validation**: Based on `program_category` — e.g., UG requires minimum 12th marks (typically 45-50%).
- **Graduation marks validation**: PG/MBA programs require minimum graduation marks.

**Approach — create an eligibility engine:**

1. **New file: `src/components/apply/eligibilityRules.ts`**
   - Define minimum marks cutoffs per `program_category`:
     - `undergraduate`: 12th marks ≥ 45%
     - `postgraduate`: Graduation marks ≥ 50%
     - `mba_pgdm`: Graduation marks ≥ 50%
     - `professional`: 12th marks ≥ 50%
     - `bed`: Graduation marks ≥ 50%
     - `school`: No marks validation (age-only)
   - Export a `validateAcademicEligibility(programCategory, academicDetails)` function returning warnings/blocks.

2. **Update `src/components/apply/AcademicDetails.tsx`**
   - Import and call eligibility validation on marks fields.
   - Show inline warning/error banners when marks are below cutoff.
   - Block "Save & Continue" if marks are strictly below minimum (with option for "Result Awaited" to bypass).

3. **Update `src/components/apply/PersonalDetails.tsx`**
   - For non-school programs, add minimum age validation on DOB (e.g., must be at least 17 for UG as of admission year).

### Technical Details

- `PhoneInput` changes: Add `disabled?: boolean` prop. When disabled, apply `opacity-60 pointer-events-none` to wrapper, disable the dropdown button and input.
- Eligibility rules will be client-side only (matching the existing age validation pattern).
- Marks parsing: Support both percentage (e.g., "85%", "85") and CGPA (e.g., "8.5") — values ≤ 10 treated as CGPA, converted to percentage using `CGPA × 9.5` formula.
- "Result Awaited" status bypasses marks validation (student hasn't received results yet).

### Files changed
- `src/components/ui/phone-input.tsx` — add `disabled` prop
- `src/components/apply/PersonalDetails.tsx` — use PhoneInput (disabled), add DOB age validation
- `src/components/apply/ParentDetails.tsx` — use PhoneInput for all parent/guardian phone fields
- `src/components/apply/eligibilityRules.ts` — new file with marks/age rules per program category
- `src/components/apply/AcademicDetails.tsx` — integrate marks validation with inline feedback

