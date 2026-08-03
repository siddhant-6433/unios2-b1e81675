-- Respect an explicit manual handler assignment.
--
-- The rule-engine trigger fires on the pending_payment -> paid transition and,
-- when no handler rule matches the request, NULLs the handler and marks it
-- 'unassigned'. That silently wiped a handler a manager had assigned by hand
-- (e.g. before payment landed, now that assignment is allowed pre-payment).
-- Skip the rule engine entirely when the row is already manually assigned.

CREATE OR REPLACE FUNCTION public.trg_assign_student_service_handler()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- A hand-picked handler wins over the rule engine and must never be
  -- overwritten by a later status/course change.
  IF NEW.assignment_status = 'manual' AND NEW.assigned_handler_user_id IS NOT NULL THEN
    RETURN NEW;
  END IF;

  IF NEW.status IN ('paid', 'under_review')
     AND (
       TG_OP = 'INSERT'
       OR OLD.status IS DISTINCT FROM NEW.status
       OR OLD.course_id IS DISTINCT FROM NEW.course_id
       OR OLD.course IS DISTINCT FROM NEW.course
       OR OLD.year_of_passing IS DISTINCT FROM NEW.year_of_passing
       OR OLD.request_type IS DISTINCT FROM NEW.request_type
     ) THEN
    PERFORM public.assign_student_service_handler(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;
