-- keep-migration-version: already recorded on production schema_migrations
-- crm sla exception review

-- Auditable SLA exception requests. These affect advisory service points only;
-- they are never connected to payroll or salary deductions.
CREATE TABLE public.crm_sla_adjustment_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  event_type text NOT NULL CHECK (event_type IN ('fresh_lead', 'followup', 'visit_outcome', 'post_visit')),
  event_id uuid NOT NULL,
  reason_code text NOT NULL CHECK (reason_code IN ('student_requested_delay','approved_leave','campus_duty','invalid_contact','system_outage','reassignment','other')),
  details text NOT NULL CHECK (length(btrim(details)) BETWEEN 10 AND 1000),
  requested_by uuid NOT NULL REFERENCES auth.users(id),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  reviewed_by uuid REFERENCES auth.users(id),
  review_note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  CONSTRAINT crm_sla_adjustment_review_consistency CHECK (
    (status = 'pending' AND reviewed_by IS NULL AND reviewed_at IS NULL)
    OR (status <> 'pending' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL AND length(btrim(coalesce(review_note,''))) >= 3)
  )
);

CREATE UNIQUE INDEX crm_sla_adjustment_one_pending_per_event
  ON public.crm_sla_adjustment_requests(event_type, event_id) WHERE status = 'pending';
CREATE INDEX crm_sla_adjustment_manager_queue
  ON public.crm_sla_adjustment_requests(status, created_at DESC);

ALTER TABLE public.crm_sla_adjustment_requests ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS crm_sla_adjustment_read_own_or_manager ON public.crm_sla_adjustment_requests;
CREATE POLICY crm_sla_adjustment_read_own_or_manager ON public.crm_sla_adjustment_requests
  FOR SELECT TO authenticated USING (
    requested_by = auth.uid()
    OR public.has_role(auth.uid(), 'super_admin')
    OR public.has_role(auth.uid(), 'campus_admin')
    OR public.has_role(auth.uid(), 'principal')
    OR public.has_role(auth.uid(), 'vice_principal')
    OR public.has_role(auth.uid(), 'admission_head')
  );
GRANT SELECT ON public.crm_sla_adjustment_requests TO authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.crm_sla_adjustment_requests FROM authenticated;

CREATE OR REPLACE FUNCTION public.crm_request_sla_adjustment(
  p_event_type text, p_event_id uuid, p_reason_code text, p_details text
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_lead_id uuid; v_request_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Authentication required'; END IF;
  IF p_event_type NOT IN ('fresh_lead','followup','visit_outcome','post_visit') THEN RAISE EXCEPTION 'Unsupported delay event'; END IF;
  IF p_reason_code NOT IN ('student_requested_delay','approved_leave','campus_duty','invalid_contact','system_outage','reassignment','other') THEN RAISE EXCEPTION 'Choose a valid reason'; END IF;
  IF length(btrim(coalesce(p_details,''))) NOT BETWEEN 10 AND 1000 THEN RAISE EXCEPTION 'Add 10 to 1000 characters of context'; END IF;
  IF p_event_type = 'fresh_lead' THEN
    SELECT l.id INTO v_lead_id FROM leads l WHERE l.id = p_event_id AND l.archived_at IS NULL
      AND (l.counsellor_id = (SELECT id FROM profiles WHERE user_id = auth.uid()) OR EXISTS (
        SELECT 1 FROM lead_assignment_history h JOIN profiles p ON p.id = h.assigned_to
        WHERE h.lead_id=l.id AND p.user_id=auth.uid()));
  ELSIF p_event_type IN ('followup','post_visit') THEN
    SELECT lf.lead_id INTO v_lead_id FROM lead_followups lf JOIN leads l ON l.id=lf.lead_id
      WHERE lf.id=p_event_id AND l.archived_at IS NULL
        AND (lf.user_id=auth.uid() OR l.counsellor_id=(SELECT id FROM profiles WHERE user_id=auth.uid()));
  ELSE
    SELECT cv.lead_id INTO v_lead_id FROM campus_visits cv JOIN leads l ON l.id=cv.lead_id
      WHERE cv.id=p_event_id AND l.archived_at IS NULL
        AND l.counsellor_id=(SELECT id FROM profiles WHERE user_id=auth.uid());
  END IF;
  IF v_lead_id IS NULL THEN RAISE EXCEPTION 'Delay event not found or not assigned to you'; END IF;
  INSERT INTO crm_sla_adjustment_requests(lead_id,event_type,event_id,reason_code,details,requested_by)
    VALUES(v_lead_id,p_event_type,p_event_id,p_reason_code,btrim(p_details),auth.uid())
    ON CONFLICT (event_type,event_id) WHERE status='pending' DO UPDATE
      SET details=EXCLUDED.details, reason_code=EXCLUDED.reason_code, created_at=now()
    RETURNING id INTO v_request_id;
  RETURN v_request_id;
END $$;

CREATE OR REPLACE FUNCTION public.crm_review_sla_adjustment(p_request_id uuid, p_decision text, p_review_note text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT (
    public.has_role(auth.uid(),'super_admin') OR public.has_role(auth.uid(),'campus_admin') OR
    public.has_role(auth.uid(),'principal') OR public.has_role(auth.uid(),'vice_principal') OR
    public.has_role(auth.uid(),'admission_head')
  ) THEN RAISE EXCEPTION 'Manager permission required'; END IF;
  IF p_decision NOT IN ('approved','rejected') THEN RAISE EXCEPTION 'Choose approve or reject'; END IF;
  IF length(btrim(coalesce(p_review_note,''))) < 3 THEN RAISE EXCEPTION 'Add a review note'; END IF;
  UPDATE crm_sla_adjustment_requests SET status=p_decision, reviewed_by=auth.uid(),
    reviewed_at=now(), review_note=btrim(p_review_note)
  WHERE id=p_request_id AND status='pending';
  IF NOT FOUND THEN RAISE EXCEPTION 'Request is no longer pending'; END IF;
END $$;

REVOKE ALL ON FUNCTION public.crm_request_sla_adjustment(text,uuid,text,text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.crm_review_sla_adjustment(uuid,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_request_sla_adjustment(text,uuid,text,text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.crm_review_sla_adjustment(uuid,text,text) TO authenticated;

-- Pending requests pause the advisory penalty while a manager reviews them.
-- Rejected requests resume the normal points calculation; approved ones remain
-- exempt. Operational recovery counts are unchanged. No payroll write exists.
ALTER FUNCTION public.counsellor_crm_reliability_snapshot() RENAME TO counsellor_crm_reliability_snapshot_unadjusted;

CREATE FUNCTION public.counsellor_crm_reliability_snapshot()
RETURNS jsonb LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public AS $$
  WITH snapshot AS MATERIALIZED (
    SELECT public.counsellor_crm_reliability_snapshot_unadjusted() AS payload
  ), exemptions AS (
    SELECT count(*)::integer AS n FROM public.crm_sla_adjustment_requests r
    WHERE r.requested_by = auth.uid() AND r.status IN ('pending','approved') AND CASE r.event_type
      WHEN 'fresh_lead' THEN EXISTS (SELECT 1 FROM public.leads l LEFT JOIN public.source_sla_config sla ON sla.source=l.source::text
        WHERE l.id=r.event_id AND l.archived_at IS NULL AND l.stage::text='new_lead' AND l.first_contact_at IS NULL
          AND l.assigned_at IS NOT NULL AND now()>l.assigned_at+make_interval(hours=>coalesce(sla.first_contact_hours,4)))
      WHEN 'followup' THEN EXISTS (SELECT 1 FROM public.lead_followups lf WHERE lf.id=r.event_id AND lf.status='pending'
        AND lf.type IS DISTINCT FROM 'cold_followup' AND lf.scheduled_at<now()-interval '24 hours')
      WHEN 'visit_outcome' THEN EXISTS (SELECT 1 FROM public.campus_visits cv WHERE cv.id=r.event_id
        AND cv.status IN ('scheduled','confirmed') AND cv.visit_date<now())
      WHEN 'post_visit' THEN EXISTS (SELECT 1 FROM public.campus_visits cv WHERE cv.id=r.event_id
        AND cv.status='completed' AND cv.visit_date<now()-interval '24 hours'
        AND NOT EXISTS (SELECT 1 FROM public.call_logs cl WHERE cl.lead_id=cv.lead_id AND cl.called_at>cv.visit_date)
        AND NOT EXISTS (SELECT 1 FROM public.lead_followups lf WHERE lf.lead_id=cv.lead_id AND lf.status='completed' AND lf.completed_at>cv.visit_date))
      ELSE false END
  ), adjusted AS (
    SELECT payload,
      greatest(0, coalesce((payload->>'points_at_risk')::integer,0) - (2 * exemptions.n)) AS at_risk
    FROM snapshot CROSS JOIN exemptions
  )
  SELECT payload || jsonb_build_object(
    'points_at_risk', at_risk,
    'shadow_score_today', coalesce((payload->>'points_earned_today')::integer,0) - at_risk,
    'pending_adjustments', (SELECT count(*)::integer FROM public.crm_sla_adjustment_requests r WHERE r.requested_by=auth.uid() AND r.status='pending'),
    'policy_version', 'shadow-v2-appealable',
    'payout_effect', false,
    'financial_deduction', false
  ) FROM adjusted;
$$;
REVOKE ALL ON FUNCTION public.counsellor_crm_reliability_snapshot_unadjusted() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.counsellor_crm_reliability_snapshot_unadjusted() TO authenticated;
REVOKE ALL ON FUNCTION public.counsellor_crm_reliability_snapshot() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.counsellor_crm_reliability_snapshot() TO authenticated;
