-- Keep unanswered calls in their call-list queue until three consecutive attempts.
-- Connected outcomes assign the lead to the caller and complete that list member;
-- call-list membership is retained for reports.
CREATE OR REPLACE FUNCTION public.fn_cleanup_cloud_dialer_pin()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_profile_id uuid;
  v_unanswered_streak integer := 0;
  v_call_is_unanswered boolean;
  v_call_is_cold boolean := false;
BEGIN
  IF NEW.user_id IS NOT NULL AND NEW.lead_id IS NOT NULL THEN
    DELETE FROM public.cloud_dialer_pins
     WHERE user_id = NEW.user_id AND lead_id = NEW.lead_id;
  END IF;

  IF NEW.lead_id IS NULL OR NEW.user_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT p.id INTO v_caller_profile_id
    FROM public.profiles p
   WHERE p.user_id = NEW.user_id
   LIMIT 1;

  v_call_is_unanswered := NEW.disposition IN ('not_answered', 'no_answer', 'busy', 'voicemail');

  IF v_call_is_unanswered THEN
    FOR v_call_is_unanswered IN
      SELECT cl.disposition IN ('not_answered', 'no_answer', 'busy', 'voicemail')
        FROM public.call_logs cl
       WHERE cl.lead_id = NEW.lead_id
         AND cl.user_id = NEW.user_id
         AND (cl.called_at, cl.id) <= (NEW.called_at, NEW.id)
       ORDER BY cl.called_at DESC, cl.id DESC
       LIMIT 3
    LOOP
      EXIT WHEN NOT v_call_is_unanswered;
      v_unanswered_streak := v_unanswered_streak + 1;
    END LOOP;
    v_call_is_cold := v_unanswered_streak >= 3;
  END IF;

  IF v_caller_profile_id IS NOT NULL AND NOT v_call_is_unanswered THEN
    UPDATE public.leads
       SET counsellor_id = v_caller_profile_id,
           updated_at = now()
     WHERE id = NEW.lead_id
       AND counsellor_id IS DISTINCT FROM v_caller_profile_id;
  END IF;

  -- A connected/reached outcome completes the current assignment. Unanswered
  -- outcomes one and two stay pending; the third is parked as Cold and worked.
  IF v_caller_profile_id IS NOT NULL AND (NOT v_call_is_unanswered OR v_call_is_cold) THEN
    UPDATE public.lead_list_members m
       SET work_status = 'worked',
           worked_at = now(),
           call_log_id = NEW.id
      FROM public.lead_lists ll
     WHERE ll.id = m.list_id
       AND ll.purpose = 'calling'
       AND ll.is_active
       AND m.lead_id = NEW.lead_id
       AND m.work_status = 'pending'
       AND m.assigned_to = v_caller_profile_id
       AND (m.assigned_at IS NULL OR COALESCE(NEW.called_at, now()) >= m.assigned_at);
  END IF;

  RETURN NEW;
END;
$$;

-- Cloud Dialer often first inserts an auto call row and then merges the
-- counsellor's chosen disposition into that same row. Re-evaluate the queue
-- after that merge as well as after new rows.
DROP TRIGGER IF EXISTS trg_cleanup_cloud_dialer_pin ON public.call_logs;
CREATE TRIGGER trg_cleanup_cloud_dialer_pin
  AFTER INSERT OR UPDATE OF disposition, user_id ON public.call_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_cleanup_cloud_dialer_pin();
