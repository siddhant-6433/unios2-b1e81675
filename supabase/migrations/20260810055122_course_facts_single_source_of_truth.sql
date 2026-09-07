-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260810055122 name=course_facts_single_source_of_truth applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

-- course_facts: the single source of truth for student-facing course information.
--
-- Before this, four surfaces each read a different field and disagreed:
--   website            -> courses.eligibility
--   counsellor Course tab -> eligibility_rules.*
--   WhatsApp templates -> courses.marketing_eligibility
--   Navya              -> hardcoded COURSE_KNOWLEDGE / KNOWLEDGE_BASE in code
-- An audit across 64 courses found 72 material conflicts (eligibility, fee,
-- duration, age, intake, entrance exam) — e.g. LLB advertised over WhatsApp as
-- "10+2 with min 50%" when it is a graduate-entry course, and BBA first-year fee
-- reading 70,000 / 55,000 / 75,000 depending on which surface you asked.
--
-- These values were reconciled by admissions against the 2026-27 fee-structure
-- workbook and signed off row by row. Every student-facing surface now renders
-- from here.
--
-- Deliberately text, not structured: the curated answers are prose
-- ("Minimum age 17 on or before 31st December, no upper limit", "800/month",
-- "Stetho Batch total fee Rs 1,85,000 across 5 semesters..."). The existing
-- structured columns (courses.duration_years, eligibility_rules.*, fee ledgers)
-- stay as they are and remain the source for COMPUTATION — fee calculation,
-- term generation, eligibility gating. course_facts is the source for DISPLAY.

CREATE TABLE IF NOT EXISTS public.course_facts (
  course_id        uuid PRIMARY KEY REFERENCES public.courses(id) ON DELETE CASCADE,
  duration         text,
  eligibility      text,
  entrance_exam    text,
  affiliation      text,
  age_requirement  text,
  intake_seats     text,
  subjects         text,
  fee_first_year   text,
  source           text NOT NULL DEFAULT 'admissions_curated_2026_27',
  verified_at      timestamptz NOT NULL DEFAULT now(),
  updated_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.course_facts IS
  'Single source of truth for student-facing course information (duration, eligibility, entrance exam, affiliation, age, intake, subjects, first-year fee). Curated by admissions and rendered by the website, the counsellor Course tab, WhatsApp templates and Navya. Structured columns elsewhere remain the source for computation.';
COMMENT ON COLUMN public.course_facts.fee_first_year IS
  'Display text, not a number — formats legitimately vary (75,000 / Rs 1,53,000 per year / 800/month / multi-semester breakdowns). Fee computation still uses the fee ledger.';

ALTER TABLE public.course_facts ENABLE ROW LEVEL SECURITY;

-- Read: the same staff roles that can already read course and template data.
DROP POLICY IF EXISTS "Staff can read course_facts" ON public.course_facts;
CREATE POLICY "Staff can read course_facts"
  ON public.course_facts FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin'::public.app_role) OR
    public.has_role(auth.uid(), 'campus_admin'::public.app_role) OR
    public.has_role(auth.uid(), 'principal'::public.app_role) OR
    public.has_role(auth.uid(), 'admission_head'::public.app_role) OR
    public.has_role(auth.uid(), 'counsellor'::public.app_role) OR
    public.has_role(auth.uid(), 'office_admin'::public.app_role) OR
    public.has_role(auth.uid(), 'accountant'::public.app_role) OR
    public.has_role(auth.uid(), 'teacher'::public.app_role) OR
    public.has_role(auth.uid(), 'faculty'::public.app_role)
  );

-- Write: admissions leadership only. This is what students are told.
DROP POLICY IF EXISTS "Admins can manage course_facts" ON public.course_facts;
CREATE POLICY "Admins can manage course_facts"
  ON public.course_facts FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin'::public.app_role) OR
    public.has_role(auth.uid(), 'admission_head'::public.app_role)
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'super_admin'::public.app_role) OR
    public.has_role(auth.uid(), 'admission_head'::public.app_role)
  );

GRANT SELECT ON public.course_facts TO authenticated;

DROP TRIGGER IF EXISTS trg_course_facts_updated_at ON public.course_facts;
CREATE TRIGGER trg_course_facts_updated_at
  BEFORE UPDATE ON public.course_facts
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
