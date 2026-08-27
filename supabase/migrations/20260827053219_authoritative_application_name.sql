-- Make the application-form name authoritative for a student's name.
--
-- Root cause: students.name is copied from leads.name at provisioning, and the
-- app->lead sync (fn_sync_application_name_to_lead) only overwrote leads.name
-- when it was still the 'Applicant' placeholder. A lead that already carried an
-- auto-captured name (Meta lead form / WhatsApp push name / staff-typed) masked
-- the applicant's typed name everywhere the record reads leads.name/students.name.
--
-- Fix: the PRIMARY application's full_name now drives BOTH leads.name and
-- students.name. Re-sync fires only when the form's full_name actually changes,
-- so a manual staff name edit made afterwards sticks until the applicant edits
-- the form again. Primary-application precedence mirrors
-- backfill_student_from_application: approved > submitted > under_review > other,
-- then latest created_at.

-- ── 1. Rewrite the app->lead/student name sync ──────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_sync_application_name_to_lead()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_primary_id uuid;
  v_name       text := btrim(NEW.full_name);
BEGIN
  -- Only act on a real name that actually changed (INSERT counts as a change).
  -- btrim: the form stores stray leading/trailing whitespace that must not leak.
  IF v_name = ''
     OR v_name = 'Applicant'
     OR NEW.lead_id IS NULL
     OR (TG_OP = 'UPDATE' AND OLD.full_name IS NOT DISTINCT FROM NEW.full_name)
  THEN
    RETURN NEW;
  END IF;

  -- Only the lead's PRIMARY application drives the authoritative name, so a
  -- secondary/draft application can't hijack it.
  SELECT a.id INTO v_primary_id
  FROM public.applications a
  WHERE a.lead_id = NEW.lead_id
  ORDER BY
    CASE a.status
      WHEN 'approved'     THEN 1
      WHEN 'submitted'    THEN 2
      WHEN 'under_review' THEN 3
      ELSE 4
    END,
    a.created_at DESC
  LIMIT 1;

  IF v_primary_id IS DISTINCT FROM NEW.id THEN
    RETURN NEW;
  END IF;

  UPDATE public.leads
  SET name = v_name, updated_at = now()
  WHERE id = NEW.lead_id
    AND name IS DISTINCT FROM v_name;

  UPDATE public.students
  SET name = v_name, updated_at = now()
  WHERE lead_id = NEW.lead_id
    AND name IS DISTINCT FROM v_name;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_app_name_to_lead ON public.applications;
CREATE TRIGGER trg_sync_app_name_to_lead
  AFTER INSERT OR UPDATE OF full_name ON public.applications
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_sync_application_name_to_lead();

-- ── 2. One-time backfill of existing divergent leads/students ───────────────
-- Pick each lead's primary application (same precedence) with a real full_name.
WITH primary_app AS (
  SELECT DISTINCT ON (a.lead_id)
    a.lead_id,
    btrim(a.full_name) AS full_name
  FROM public.applications a
  WHERE a.lead_id IS NOT NULL
    AND btrim(a.full_name) <> ''
    AND btrim(a.full_name) <> 'Applicant'
  ORDER BY
    a.lead_id,
    CASE a.status
      WHEN 'approved'     THEN 1
      WHEN 'submitted'    THEN 2
      WHEN 'under_review' THEN 3
      ELSE 4
    END,
    a.created_at DESC
)
UPDATE public.leads l
SET name = pa.full_name, updated_at = now()
FROM primary_app pa
WHERE l.id = pa.lead_id
  AND l.name IS DISTINCT FROM pa.full_name;

WITH primary_app AS (
  SELECT DISTINCT ON (a.lead_id)
    a.lead_id,
    btrim(a.full_name) AS full_name
  FROM public.applications a
  WHERE a.lead_id IS NOT NULL
    AND btrim(a.full_name) <> ''
    AND btrim(a.full_name) <> 'Applicant'
  ORDER BY
    a.lead_id,
    CASE a.status
      WHEN 'approved'     THEN 1
      WHEN 'submitted'    THEN 2
      WHEN 'under_review' THEN 3
      ELSE 4
    END,
    a.created_at DESC
)
UPDATE public.students s
SET name = pa.full_name, updated_at = now()
FROM primary_app pa
WHERE s.lead_id = pa.lead_id
  AND s.name IS DISTINCT FROM pa.full_name;
