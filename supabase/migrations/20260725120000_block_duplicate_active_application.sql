-- Block creating a second application for the same course-selection set + session
-- when the student already has a non-terminal (active / in-progress) application.
--
-- A student may re-apply only after the prior application is terminal
-- (rejected / cancelled / withdrawn). "Course set" is compared as the set of
-- (course_id, campus_id) pairs, order-insensitive: the ENTIRE selection must match.
-- Runs BEFORE INSERT so it covers every entry point (portal insert + academic-
-- partner on-behalf edge fn), which both INSERT straight into this table.
CREATE OR REPLACE FUNCTION public.block_duplicate_active_application()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_sig text[];
BEGIN
  -- Can't dedupe an anonymous / session-less / course-less draft.
  IF NEW.lead_id IS NULL
     OR NEW.session_id IS NULL
     OR COALESCE(jsonb_array_length(NEW.course_selections), 0) = 0
  THEN
    RETURN NEW;
  END IF;

  -- Canonical signature: sorted "course_id:campus_id" pairs.
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
