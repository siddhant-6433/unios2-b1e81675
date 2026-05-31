-- PR1 Visit track — link post-visit follow-ups to their visit, retire type='visit'.
--
-- Background: scheduling a campus visit writes campus_visits; the post-visit
-- follow-up is a lead_followups row. Until now there was no link between them,
-- and a dead "Visit" option in ScheduleFollowupDialog wrote type='visit' rows
-- that bypassed the whole visit pipeline. We add an explicit FK and retire
-- type='visit' (post-visit follow-ups are type='call' carrying visit_id).

-- 1. Explicit link follow-up → visit ----------------------------------------
ALTER TABLE public.lead_followups
  ADD COLUMN IF NOT EXISTS visit_id uuid REFERENCES public.campus_visits(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_lead_followups_visit_id
  ON public.lead_followups (visit_id) WHERE visit_id IS NOT NULL;

COMMENT ON COLUMN public.lead_followups.visit_id IS
  'When set, this follow-up is the post-visit follow-up for that campus_visits row. Drives the Visit funnel "Visit Follow-up" box. NULL for ordinary call follow-ups.';

-- 2. No-show auto-followup now stamps visit_id -------------------------------
-- The trigger fires on campus_visits UPDATE, so NEW.id is the visit.
CREATE OR REPLACE FUNCTION public.fn_visit_no_show_followup()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_next_date date;
  v_counsellor_user_id uuid;
BEGIN
  IF OLD.status IS DISTINCT FROM 'no_show' AND NEW.status = 'no_show' THEN
    v_next_date := CURRENT_DATE + 1;
    IF EXTRACT(DOW FROM v_next_date) = 0 THEN
      v_next_date := v_next_date + 1;
    END IF;

    INSERT INTO public.lead_followups (lead_id, scheduled_at, type, notes, status, visit_id)
    VALUES (
      NEW.lead_id,
      (v_next_date || ' 04:30:00+00')::timestamptz,  -- 10:00 AM IST
      'call',
      'Auto: No-show follow-up. Original visit was ' || to_char(NEW.visit_date, 'DD Mon YYYY') || '. Call to reschedule or close.',
      'pending',
      NEW.id
    );

    SELECT p.user_id INTO v_counsellor_user_id
    FROM leads l JOIN profiles p ON p.id = l.counsellor_id
    WHERE l.id = NEW.lead_id;

    IF v_counsellor_user_id IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, type, title, body, link, lead_id)
      VALUES (
        v_counsellor_user_id,
        'visit_no_show',
        'No-show: Follow-up scheduled',
        'Visit marked no-show. Follow-up call auto-scheduled for ' || to_char(v_next_date, 'DD Mon') || '. Call to reschedule or close.',
        '/admissions/' || NEW.lead_id,
        NEW.lead_id
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- 3. Retire legacy type='visit' rows -----------------------------------------
-- Convert each to type='call' and link the closest campus_visit for that lead
-- (by |scheduled_at - visit_date|). Rows with no matching visit just become
-- type='call' with a NULL visit_id (still tracked, just unlinked).
UPDATE public.lead_followups lf
   SET type     = 'call',
       visit_id = sub.visit_id
  FROM (
    SELECT f.id AS followup_id,
           (SELECT cv.id
              FROM public.campus_visits cv
             WHERE cv.lead_id = f.lead_id
             ORDER BY ABS(EXTRACT(EPOCH FROM (cv.visit_date - f.scheduled_at)))
             LIMIT 1) AS visit_id
      FROM public.lead_followups f
     WHERE f.type = 'visit'
  ) sub
 WHERE lf.id = sub.followup_id;
