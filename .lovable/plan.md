

## Plan: Configurable Eligibility Rules with Subject/Stream Prerequisites

### Database Change

Create an `eligibility_rules` table with per-course configurable rules including subject/stream prerequisites:

```sql
CREATE TABLE public.eligibility_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  course_id uuid NOT NULL REFERENCES public.courses(id) ON DELETE CASCADE,
  min_age integer,
  max_age integer,
  class_12_min_marks numeric,
  graduation_min_marks numeric,
  requires_graduation boolean DEFAULT false,
  entrance_exam_name text,
  entrance_exam_required boolean DEFAULT false,
  subject_prerequisites text[],  -- e.g. {"PCM","PCB","Science"}
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(course_id)
);

ALTER TABLE public.eligibility_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage eligibility rules" ON public.eligibility_rules
  FOR ALL TO authenticated USING (has_role(auth.uid(), 'super_admin'::app_role));

CREATE POLICY "Anyone can view eligibility rules" ON public.eligibility_rules
  FOR SELECT TO anon, authenticated USING (true);

CREATE TRIGGER update_eligibility_rules_updated_at
  BEFORE UPDATE ON public.eligibility_rules
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
```

### Files to Change

**1. New: `src/components/admin/EligibilityRuleDialog.tsx`**
- Dialog with fields: Min Age, Max Age, Class 12 Min %, Graduation Min %, Requires Graduation (toggle), Entrance Exam Name, Entrance Exam Required (toggle), Subject Prerequisites (comma-separated input like "PCM, PCB, Commerce"), Notes
- Upserts into `eligibility_rules` on save

**2. `src/components/admin/CourseCampusMaster.tsx`**
- Fetch `eligibility_rules` alongside courses
- Add a "Rules" button/icon next to each course row that opens `EligibilityRuleDialog`
- Show small badges on courses that have rules configured (e.g., "Min 45%", "CAT Required", "PCM")

**3. `src/components/apply/eligibilityRules.ts`**
- Add `EligibilityRuleDB` interface matching the DB columns
- Add `fetchEligibilityRules(courseIds: string[])` that queries the table
- Update `validateAcademicEligibility` and `validateDobEligibility` to accept DB rules (with max age support)
- Add `validateSubjectPrerequisites(rule, academicDetails)` returning a warning/error if Class 12 subjects don't match prerequisites
- Add `validateEntranceRequirement(rule)` returning info if entrance exam is needed
- Keep hardcoded `ELIGIBILITY_RULES` as fallback when no DB rule exists

**4. `src/components/apply/AcademicDetails.tsx`**
- Fetch eligibility rules for selected course IDs on mount
- Show subject prerequisite warnings (e.g., "This course requires PCM stream in Class 12")
- Show entrance exam info banner if applicable
- Show "Requires completed graduation" warning for PG courses
- Validate against DB rules instead of hardcoded when available

**5. `src/components/apply/PersonalDetails.tsx`**
- Fetch rules and validate DOB against both min and max age from DB

**6. `src/pages/ApplyPortal.tsx`**
- Fetch eligibility rules after course selection for the Course Summary Banner badges

### Eligibility Fields

| Field | Purpose | Example |
|---|---|---|
| `min_age` | Lower age limit (July 31) | 17 for UG |
| `max_age` | Upper age limit (July 31) | 25 for some courses |
| `class_12_min_marks` | Min % in Class 12 | 45% |
| `graduation_min_marks` | Min % in Graduation | 50% |
| `requires_graduation` | Must have UG degree | true for B.Ed, MBA |
| `entrance_exam_name` | Exam name | "CAT", "CTET", "CUET" |
| `entrance_exam_required` | Mandatory exam | true/false |
| `subject_prerequisites` | Required Class 12 stream/subjects | ["PCM"], ["PCB", "Science"] |
| `notes` | Custom text shown to applicant | "SC/ST relaxation: 5%" |

