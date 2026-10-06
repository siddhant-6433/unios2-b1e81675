-- Notify super admins after a refund draft has its final amount.
-- The deferred trigger covers both student refunds (inserted at zero, then
-- totalled) and lead refunds (inserted with the total already set).

CREATE OR REPLACE FUNCTION public.notify_super_admins_of_fee_refund_draft()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_candidate_name text;
  v_total_amount numeric;
  v_status text;
BEGIN
  IF NEW.status <> 'draft' OR NEW.total_amount <= 0 THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND (OLD.status IS DISTINCT FROM 'draft' OR OLD.total_amount <> 0) THEN
    RETURN NEW;
  END IF;

  SELECT COALESCE(s.name, l.name, 'Candidate')
       , fr.total_amount
       , fr.status
    INTO v_candidate_name, v_total_amount, v_status
    FROM public.fee_refunds fr
    LEFT JOIN public.students s ON s.id = fr.student_id
    LEFT JOIN public.leads l ON l.id = fr.lead_id
   WHERE fr.id = NEW.id;

  -- Constraint triggers run at transaction end. Read the row's committed-in-
  -- transaction values rather than the event snapshot captured by NEW.
  IF v_status IS DISTINCT FROM 'draft' OR COALESCE(v_total_amount, 0) <= 0 THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.notifications (user_id, type, title, body, link)
  SELECT ur.user_id,
         'approval_pending',
         'New refund request',
         format('%s · ₹%s is awaiting approval.',
           COALESCE(v_candidate_name, 'Candidate'),
           to_char(v_total_amount, 'FM999,999,999,990.00')),
         format('/finance?tab=refunds&status=draft&refund_id=%s', NEW.id)
    FROM public.user_roles ur
   WHERE ur.role = 'super_admin'::public.app_role;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_notify_super_admins_of_fee_refund_draft ON public.fee_refunds;
CREATE CONSTRAINT TRIGGER trg_notify_super_admins_of_fee_refund_draft
AFTER INSERT OR UPDATE ON public.fee_refunds
DEFERRABLE INITIALLY DEFERRED
FOR EACH ROW
EXECUTE FUNCTION public.notify_super_admins_of_fee_refund_draft();
