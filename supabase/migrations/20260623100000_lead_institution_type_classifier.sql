-- Persist the admissions institution classifier on leads so the Admissions
-- School/College filter matches the bucket classifier even when course_id is
-- NULL (for example JustDial school categories and campus-routed school leads).

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS lead_institution_type text NOT NULL DEFAULT 'college';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'leads_lead_institution_type_check'
      AND conrelid = 'public.leads'::regclass
  ) THEN
    ALTER TABLE public.leads
      ADD CONSTRAINT leads_lead_institution_type_check
      CHECK (lead_institution_type IN ('school', 'college'));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.compute_lead_institution_type(
  _course_id uuid,
  _campus_id uuid,
  _jd_category text
)
RETURNS text
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT CASE
    WHEN i.type IN ('school', 'college') THEN i.type
    WHEN cam_inst.type = 'school'        THEN 'school'
    WHEN jdm.is_school = true            THEN 'school'
    ELSE 'college'
  END
  FROM (SELECT 1) seed
  LEFT JOIN public.courses c
    ON c.id = _course_id
  LEFT JOIN public.departments d
    ON d.id = c.department_id
  LEFT JOIN public.institutions i
    ON i.id = d.institution_id
  LEFT JOIN LATERAL (
    SELECT ci.type
    FROM public.institutions ci
    WHERE ci.campus_id = _campus_id
      AND ci.type = 'school'
    LIMIT 1
  ) cam_inst ON true
  LEFT JOIN LATERAL (
    SELECT jm.is_school
    FROM public.jd_category_mappings jm
    WHERE lower(jm.category) = lower(_jd_category)
    LIMIT 1
  ) jdm ON true;
$$;

CREATE OR REPLACE FUNCTION public.set_lead_institution_type()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  NEW.lead_institution_type :=
    public.compute_lead_institution_type(NEW.course_id, NEW.campus_id, NEW.jd_category);
  RETURN NEW;
END;
$$;

UPDATE public.leads l
SET lead_institution_type = public.compute_lead_institution_type(l.course_id, l.campus_id, l.jd_category)
WHERE l.lead_institution_type IS DISTINCT FROM
  public.compute_lead_institution_type(l.course_id, l.campus_id, l.jd_category);

DROP TRIGGER IF EXISTS trg_set_lead_institution_type ON public.leads;
CREATE TRIGGER trg_set_lead_institution_type
  BEFORE INSERT OR UPDATE OF course_id, campus_id, jd_category
  ON public.leads
  FOR EACH ROW
  EXECUTE FUNCTION public.set_lead_institution_type();

CREATE INDEX IF NOT EXISTS idx_leads_institution_type_created_id
  ON public.leads (lead_institution_type, created_at DESC, id DESC);

COMMENT ON COLUMN public.leads.lead_institution_type IS
  'Admissions classifier: school when course institution, school campus, or JD category maps to school; otherwise college.';

GRANT EXECUTE ON FUNCTION public.compute_lead_institution_type(uuid, uuid, text) TO authenticated;
