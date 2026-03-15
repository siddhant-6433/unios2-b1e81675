

## Plan: Hide Subject-wise Marks When Class 12 Result is "Not Declared"

**Problem**: The English marks input (and any other subject-wise marks) still appears even when the student selects "Result Not Declared" for Class 12.

**Fix**: In `AcademicDetails.tsx` at line ~644, add a condition to also check `academic?.class_12?.result_status !== 'not_declared'` before rendering the subject-wise marks section.

**File**: `src/components/apply/AcademicDetails.tsx`

Change the condition from:
```tsx
{requiredSubjectMarks.size > 0 && (
```
to:
```tsx
{requiredSubjectMarks.size > 0 && academic?.class_12?.result_status !== 'not_declared' && (
```

Single line change in one file.

