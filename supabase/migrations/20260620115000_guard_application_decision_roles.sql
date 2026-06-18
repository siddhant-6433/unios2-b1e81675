-- Staff update policies are intentionally broad because counsellors and office
-- staff edit application details. Application decisions are different: only
-- principals and super admins may approve/reject an application.
CREATE OR REPLACE FUNCTION public.guard_application_decision_roles()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (
    NEW.status IS DISTINCT FROM OLD.status
    AND NEW.status IN ('approved', 'rejected')
  ) OR NEW.approved_at IS DISTINCT FROM OLD.approved_at
    OR NEW.approved_by IS DISTINCT FROM OLD.approved_by
    OR NEW.rejection_reason IS DISTINCT FROM OLD.rejection_reason
  THEN
    IF COALESCE(auth.role(), '') = 'service_role' THEN
      RETURN NEW;
    END IF;

    IF NOT (
      public.has_role(auth.uid(), 'super_admin')
      OR public.has_role(auth.uid(), 'principal')
    ) THEN
      RAISE EXCEPTION 'Only principals and super admins can approve or reject applications';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_application_decision_roles ON public.applications;
CREATE TRIGGER trg_guard_application_decision_roles
  BEFORE UPDATE OF status, approved_at, approved_by, rejection_reason
  ON public.applications
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_application_decision_roles();
