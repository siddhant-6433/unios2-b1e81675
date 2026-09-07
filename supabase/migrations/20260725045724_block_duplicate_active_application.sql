-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260725045724 name=block_duplicate_active_application applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

CREATE OR REPLACE FUNCTION public.block_duplicate_active_application()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_sig text[];
BEGIN
  IF NEW.lead_id IS NULL
     OR NEW.session_id IS NULL
     OR COALESCE(jsonb_array_length(NEW.course_selections), 0) = 0
  THEN
    RETURN NEW;
  END IF;

  SELECT array_agg(pair ORDER BY pair) INTO new_sig
  FROM (
    SELECT COALESCE(elem->>'course_id', '') || ':' || COALESCE(elem->>'campus_id', '') AS pair
    FROM jsonb_array_elements(NEW.course_selections) elem
  ) t;

  IF EXISTS (
    SELECT 1
    FROM public.applications a
    WHERE a.id IS DISTINCT FROM NEW.id
      AND a.lead_id = NEW.lead_id
      AND a.session_id = NEW.session_id
      AND COALESCE(a.status, 'draft') NOT IN ('rejected', 'cancelled', 'withdrawn')
      AND (
        SELECT array_agg(pair ORDER BY pair)
        FROM (
          SELECT COALESCE(elem->>'course_id', '') || ':' || COALESCE(elem->>'campus_id', '') AS pair
          FROM jsonb_array_elements(a.course_selections) elem
        ) t2
      ) = new_sig
  ) THEN
    RAISE EXCEPTION 'You already have an application for this course in this session.'
      USING ERRCODE = 'unique_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_block_duplicate_active_application ON public.applications;
CREATE TRIGGER trg_block_duplicate_active_application
  BEFORE INSERT ON public.applications
  FOR EACH ROW
  EXECUTE FUNCTION public.block_duplicate_active_application();
