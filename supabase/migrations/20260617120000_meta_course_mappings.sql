-- meta_course_mappings
-- Maps a Meta (Facebook/Instagram) lead form's COURSE-question answer → a course.
--
-- Meta forms ask "which course / programme are you interested in?" and the answer
-- is an option key like "llb_(3_years)" or "b.sc_nursing". Most of these match a
-- course name once underscores are normalised to spaces, but some don't (the law
-- programmes carry year qualifiers; D.Ed/B.Ed shorthands), so leads landed with
-- course_id NULL and "Meta Ads + course" came up empty on Lead Buckets.
--
-- This is the JustDial jd_category_mappings pattern applied at the ANSWER level
-- (forms are multi-course, so we resolve per answer, not per form):
--   answer_value (normalised) → course_id, admin-managed, unknowns 'pending'.
-- School forms ask class/grade (not a course) so they produce no answer here and
-- stay course-less, which is correct.

CREATE TABLE IF NOT EXISTS public.meta_course_mappings (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  answer_value  text        UNIQUE NOT NULL,          -- normalised answer (lowercase, '_'→' ')
  course_id     uuid        REFERENCES public.courses(id) ON DELETE SET NULL,
  status        text        NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending', 'resolved', 'ignored')),
  sample_form_name text,                              -- a form the value was seen on (admin context)
  resolved_by   uuid        REFERENCES auth.users(id) ON DELETE SET NULL,
  resolved_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_meta_course_status ON public.meta_course_mappings (status);
CREATE INDEX IF NOT EXISTS idx_meta_course_value  ON public.meta_course_mappings (lower(answer_value));

-- RLS parity with jd_category_mappings: super_admin read/write, others read-only.
ALTER TABLE public.meta_course_mappings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "super_admin_full_access" ON public.meta_course_mappings
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

CREATE POLICY "authenticated_read" ON public.meta_course_mappings
  FOR SELECT TO authenticated USING (true);

GRANT SELECT, INSERT, UPDATE ON public.meta_course_mappings TO service_role;

-- ── Seed the known answer values → courses ───────────────────────────────────
-- Course lookups are by stable code so this is environment-portable. Campus
-- choices per product: LLB 3-year → Kotputli, BA LLB 5-year → BALLB, B.Ed →
-- Greater Noida, D.Ed → D.El.Ed. The rest match their course on name.
INSERT INTO public.meta_course_mappings (answer_value, course_id, status, resolved_at)
SELECT v.answer_value, c.id, 'resolved', now()
FROM (VALUES
  ('bpt',              'BPT-GN'),
  ('dpt',              'DPT-GN'),
  ('ott',              'DAOTT-GN'),
  ('gnm',              'GNM-GN'),
  ('b.sc nursing',     'BSCN-GN'),
  ('bmrit',            'BMRIT-GN'),
  ('bba',              'BBA-GN'),
  ('mba',              'MBA-GN'),
  ('bca',              'BCA-GN'),
  ('pgdm',             'PGDM-GN'),
  ('bed',              'BED-GN'),
  ('b.ed',             'BED-GN'),
  ('ded',              'DELED-GZ'),
  ('d.ed',             'DELED-GZ'),
  ('d.el.ed',          'DELED-GZ'),
  ('llb (3 years)',    'LLB-KT'),
  ('ba llb (5 years)', 'BALLB-GN')
) AS v(answer_value, code)
JOIN public.courses c ON c.code = v.code
ON CONFLICT (answer_value) DO NOTHING;

-- ── Backfill existing course-less Meta leads ─────────────────────────────────
-- Only fills blanks (course_id IS NULL) — never overwrites a course already set.
-- Mirrors the edge-function precedence: mapping table → fuzzy name match.
WITH cand AS (
  SELECT l.id,
    (SELECT replace(lower(elem->'values'->>0), '_', ' ')
       FROM jsonb_array_elements(l.raw_form_data::jsonb) AS elem
      WHERE elem->>'name' ~* '(course|programme|program)'
        AND elem->>'name' !~* 'stream'
      LIMIT 1) AS answer
  FROM public.leads l
  WHERE l.source = 'meta_ads' AND l.course_id IS NULL
),
resolved AS (
  SELECT cand.id AS lead_id,
    COALESCE(
      (SELECT m.course_id FROM public.meta_course_mappings m
         WHERE m.answer_value = cand.answer AND m.status = 'resolved'),
      (SELECT c.id FROM public.courses c
         WHERE cand.answer IS NOT NULL AND c.name ILIKE '%' || cand.answer || '%'
         ORDER BY length(c.name) LIMIT 1)
    ) AS new_course_id
  FROM cand
  WHERE cand.answer IS NOT NULL AND cand.answer <> ''
)
UPDATE public.leads
SET course_id = resolved.new_course_id
FROM resolved
WHERE public.leads.id = resolved.lead_id
  AND resolved.new_course_id IS NOT NULL;
