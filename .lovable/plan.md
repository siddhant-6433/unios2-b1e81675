

## Plan: Add Course Selection Display & Edit Capability

### Problem
Once a user selects courses in Step 0, they cannot view or edit their course selections/preferences during the rest of the application flow. There is no "Edit Courses" option anywhere after the initial selection.

### Solution
Add a **Course Summary Banner** below the welcome header (above the step progress bar) that:
1. Shows selected courses with preference order, campus, and eligibility status
2. Includes an "Edit Courses" button that reopens the CourseSelector
3. Supports updating course selections on an existing application (not just creating new ones)

### Files to Change

**1. `src/pages/ApplyPortal.tsx`**
- Add a collapsible course summary section between the welcome header (line ~797) and the `DynamicStepProgress` (line ~799)
- Display each selected course with preference order, name, campus, and program category
- Show age/marks eligibility badges using `validateDobEligibility` and `validateAcademicEligibility` from `eligibilityRules.ts`
- Add an "Edit Courses" button that sets `showCourseSelector = true`
- Modify `handleCourseSelected` to also handle **updates** (not just inserts) — when `app` already exists, update the existing application's `course_selections`, `fee_amount`, and `program_category` instead of inserting a new row
- Pass `app` to CourseSelector when editing so it can pre-populate existing selections

**2. `src/components/apply/CourseSelector.tsx`**
- Accept optional `existingSelections` and `existingSession` props to pre-populate when editing
- Accept optional `onCancel` prop to allow going back without changes
- Initialize `selections` and `selectedSession` from existing data when provided
- Show a "Cancel" button alongside "Continue" when editing

### Technical Details

- The course summary banner will use `Badge` components with color coding: green for eligible, amber for guidance, red for strict block
- Fee recalculation happens automatically via `calculateFee()` when selections change
- The existing `saveSection` pattern is reused — course updates go through `supabase.from("applications").update()`
- When editing, the CourseSelector shows pre-selected session (disabled) and pre-populated course list that can be modified

### UI Layout (in the main form view)
```text
┌─────────────────────────────────────────┐
│ Welcome, Name                           │
│ Application ID: APP-26-XXXX             │
│                                         │
│ ┌─ Selected Courses ──────────────────┐ │
│ │ P1  Grade 1 — Main Campus    ✓ Age  │ │
│ │ P2  Grade 2 — Main Campus    ⚠ Age  │ │
│ │            Fee: ₹1,000  [Edit]      │ │
│ └─────────────────────────────────────┘ │
│                                         │
│ [Personal] [Parents] [Academic] ...     │
│ ┌─────────────────────────────────────┐ │
│ │         Current Step Content        │ │
│ └─────────────────────────────────────┘ │
└─────────────────────────────────────────┘
```

