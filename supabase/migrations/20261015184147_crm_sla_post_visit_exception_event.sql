-- keep-migration-version: already recorded on production schema_migrations
-- crm sla post visit exception event

-- Post-visit queue rows carry the campus visit ID, not a follow-up task ID.
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
  ELSIF p_event_type = 'followup' THEN
    SELECT lf.lead_id INTO v_lead_id FROM lead_followups lf JOIN leads l ON l.id=lf.lead_id
      WHERE lf.id=p_event_id AND l.archived_at IS NULL
        AND (lf.user_id=auth.uid() OR l.counsellor_id=(SELECT id FROM profiles WHERE user_id=auth.uid()));
  ELSE
    SELECT cv.lead_id INTO v_lead_id FROM campus_visits cv JOIN leads l ON l.id=cv.lead_id
      WHERE cv.id=p_event_id AND l.archived_at IS NULL
        AND (p_event_type='visit_outcome' OR (cv.status='completed' AND NOT EXISTS (
          SELECT 1 FROM call_logs cl WHERE cl.lead_id=cv.lead_id AND cl.called_at>cv.visit_date
        ) AND NOT EXISTS (
          SELECT 1 FROM lead_followups lf WHERE lf.lead_id=cv.lead_id AND lf.status='completed' AND lf.completed_at>cv.visit_date
        )))
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

REVOKE ALL ON FUNCTION public.crm_request_sla_adjustment(text,uuid,text,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_request_sla_adjustment(text,uuid,text,text) TO authenticated;
