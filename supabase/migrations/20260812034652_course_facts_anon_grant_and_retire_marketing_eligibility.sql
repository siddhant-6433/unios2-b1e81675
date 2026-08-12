-- 1. Let the public website read the curated course facts.
--
-- nimt.ac.in is a separate Netlify site (nimtweb). Neither course_facts nor
-- course_marketing_info granted SELECT to anon, so a browser-side read returned
-- zero rows — silently, which is the exact failure mode that caused the original
-- "templates look fake" bug.
--
-- course_marketing_info is owned by postgres and is NOT security_invoker, so the
-- grant exposes precisely its columns and nothing else. course_facts itself
-- stays staff-only: the website reads through the view.
GRANT SELECT ON public.course_marketing_info TO anon;

-- The view calls fn_course_affiliation_label for its `affiliation` column, so
-- the SELECT grant alone is not enough — PostgREST returns 42501 "permission
-- denied for function". Found by an actual anon HTTP request; the grant and
-- dependency checks did not surface it. The function is SECURITY DEFINER and
-- returns only a public affiliation label, so anon EXECUTE is safe.
-- fn_course_facts is deliberately NOT granted: the site reads the view.
GRANT EXECUTE ON FUNCTION public.fn_course_affiliation_label(uuid) TO anon;

COMMENT ON VIEW public.course_marketing_info IS
  'Public course information for the marketing website. Curated fields resolve from course_facts, falling back to legacy courses columns. Readable by anon.';

-- 2. Retire courses.marketing_eligibility.
--
-- This is the field that told LLB enquirers "10+2 with min 50%" for a
-- graduate-entry course, and BBA/BCA "50%" against an actual 45% cutoff. It was
-- hand-maintained, read only by the WhatsApp path, and disagreed with the
-- website, the counsellor Course tab and eligibility_rules.
--
-- Verified dead before dropping: no application code writes or reads it, no
-- function references it (pg_get_functiondef scan over public), no view depends
-- on it. The 18 superseded values remain recoverable from the original seed
-- migration 20260517145219_courses_marketing_eligibility.sql in git history.
--
-- Curated eligibility now lives in course_facts.eligibility.
ALTER TABLE public.courses DROP COLUMN IF EXISTS marketing_eligibility;

-- 3. State the rule where the next person will find it.
COMMENT ON TABLE public.course_facts IS
  'Single source of truth for student-facing course information. THE RULE: structured columns compute, course_facts displays. Anything shown to a student, parent or counsellor (duration, eligibility, entrance exam, affiliation, age, intake, subjects, first-year fee) reads from here via fn_course_facts. The structured columns elsewhere — courses.duration_years/type, courses.fee_per_year, eligibility_rules.* — stay because they do arithmetic that prose cannot: fee and term generation, apply-portal age/marks gating, scholarship calculation, application-form mismatch warnings. Do not sync this table back into them; 29 of 48 curated fees are not numbers.';
