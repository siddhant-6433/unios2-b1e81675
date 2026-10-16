-- keep-migration-version: already recorded on production schema_migrations
-- crm work queue manager recovery

-- Manager recovery snapshot and transparent explanation of the current score.
-- Both functions run as the caller and therefore retain table RLS policies.

CREATE OR REPLACE FUNCTION public.crm_manager_recovery_snapshot(
  p_limit integer DEFAULT 100,
  p_scope_counsellor_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_profile_id uuid;
  v_is_manager boolean;
  v_rows jsonb;
  v_counts jsonb;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;

  v_is_manager :=
    public.has_role(v_user_id, 'super_admin') OR
    public.has_role(v_user_id, 'campus_admin') OR
    public.has_role(v_user_id, 'principal') OR
    public.has_role(v_user_id, 'vice_principal') OR
    public.has_role(v_user_id, 'admission_head');

  IF NOT v_is_manager AND NOT public.has_role(v_user_id, 'counsellor') THEN
    RAISE EXCEPTION 'CRM recovery access required' USING ERRCODE = '42501';
  END IF;

  SELECT p.id INTO v_profile_id FROM public.profiles p WHERE p.user_id = v_user_id LIMIT 1;
  IF v_profile_id IS NULL THEN
    RAISE EXCEPTION 'Counsellor profile not found' USING ERRCODE = 'P0002';
  END IF;

  IF NOT v_is_manager THEN
    p_scope_counsellor_id := v_profile_id;
  END IF;

  WITH scoped_leads AS MATERIALIZED (
    SELECT l.id, l.name, l.phone, l.stage::text AS stage, l.source::text AS source,
           l.lead_score, l.lead_temperature, l.counsellor_id, owner.display_name AS owner_name, l.created_at,
           l.assigned_at, l.first_contact_at, l.campus_id, l.course_id,
           sla.first_contact_hours
    FROM public.leads l
    LEFT JOIN public.profiles owner ON owner.id = l.counsellor_id
    LEFT JOIN public.source_sla_config sla ON sla.source = l.source::text
    WHERE l.archived_at IS NULL
      AND l.stage::text NOT IN ('admitted', 'rejected', 'not_interested', 'ineligible', 'dnc', 'deferred', 'duplicate', 'course_not_available')
      AND (p_scope_counsellor_id IS NULL OR l.counsellor_id = p_scope_counsellor_id)
  ),
  pending_action AS (
    SELECT DISTINCT ON (lf.lead_id)
      lf.lead_id, lf.id, lf.type, lf.scheduled_at, lf.notes
    FROM public.lead_followups lf
    JOIN scoped_leads sl ON sl.id = lf.lead_id
    WHERE lf.status = 'pending'
    ORDER BY lf.lead_id, lf.scheduled_at, lf.created_at
  ),
  classified AS (
    SELECT sl.*, pa.id AS action_id, pa.type AS action_type,
           pa.scheduled_at AS action_due_at, pa.notes AS action_notes,
      CASE
        WHEN sl.counsellor_id IS NULL THEN 'unassigned'
        WHEN sl.stage = 'new_lead' AND sl.first_contact_at IS NULL
          AND sl.assigned_at IS NOT NULL
          AND now() > sl.assigned_at + make_interval(hours => COALESCE(sl.first_contact_hours, 4))
          THEN 'fresh_sla_breached'
        WHEN sl.lead_temperature = 'hot' AND sl.first_contact_at IS NULL THEN 'hot_untouched'
        WHEN pa.scheduled_at < now() - interval '3 days' THEN 'overdue_over_3_days'
        WHEN pa.scheduled_at < now() - interval '1 day' THEN 'overdue_1_to_3_days'
        WHEN pa.scheduled_at < now() THEN 'overdue_under_1_day'
        WHEN pa.id IS NULL THEN 'missing_next_action'
        WHEN sl.phone IS NULL OR btrim(sl.phone) = '' THEN 'no_contact_channel'
        ELSE NULL
      END AS recovery_reason
    FROM scoped_leads sl
    LEFT JOIN pending_action pa ON pa.lead_id = sl.id
  ),
  recovery AS (
    SELECT * FROM classified WHERE recovery_reason IS NOT NULL
  ),
  summary AS (
    SELECT jsonb_object_agg(reason, n) AS counts
    FROM (
      SELECT recovery_reason AS reason, count(*)::integer AS n
      FROM recovery GROUP BY recovery_reason
    ) q
  ),
  rows AS (
    SELECT jsonb_agg(to_jsonb(r) ORDER BY
      CASE r.recovery_reason
        WHEN 'unassigned' THEN 1
        WHEN 'fresh_sla_breached' THEN 2
        WHEN 'hot_untouched' THEN 3
        WHEN 'overdue_over_3_days' THEN 4
        WHEN 'overdue_1_to_3_days' THEN 5
        WHEN 'overdue_under_1_day' THEN 6
        WHEN 'missing_next_action' THEN 7
        ELSE 8
      END,
      COALESCE(r.action_due_at, r.assigned_at, r.created_at) ASC
    ) AS items
    FROM (SELECT * FROM recovery ORDER BY
      CASE recovery_reason
        WHEN 'unassigned' THEN 1 WHEN 'fresh_sla_breached' THEN 2
        WHEN 'hot_untouched' THEN 3 WHEN 'overdue_over_3_days' THEN 4
        WHEN 'overdue_1_to_3_days' THEN 5 WHEN 'overdue_under_1_day' THEN 6
        WHEN 'missing_next_action' THEN 7 ELSE 8 END,
      COALESCE(action_due_at, assigned_at, created_at) ASC
      LIMIT greatest(1, least(COALESCE(p_limit, 100), 500))) r
  )
  SELECT COALESCE(summary.counts, '{}'::jsonb), COALESCE(rows.items, '[]'::jsonb)
  INTO v_counts, v_rows FROM summary CROSS JOIN rows;

  RETURN jsonb_build_object(
    'as_of', now(), 'timezone', 'Asia/Kolkata',
    'scope_counsellor_id', p_scope_counsellor_id,
    'counts', v_counts, 'items', v_rows
  );
END;
$$;

REVOKE ALL ON FUNCTION public.crm_manager_recovery_snapshot(integer, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_manager_recovery_snapshot(integer, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.crm_lead_score_explanation(p_lead_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH lead_row AS (
    SELECT l.* FROM public.leads l WHERE l.id = p_lead_id
  ),
  activity AS (
    SELECT count(*)::integer AS activity_count
    FROM public.lead_activities a WHERE a.lead_id = p_lead_id
  ),
  parts AS (
    SELECT l.id,
      CASE l.stage::text
        WHEN 'new_lead' THEN 0 WHEN 'application_in_progress' THEN 10
        WHEN 'application_fee_paid' THEN 20 WHEN 'application_submitted' THEN 25
        WHEN 'ai_called' THEN 15 WHEN 'counsellor_call' THEN 20
        WHEN 'visit_scheduled' THEN 30 WHEN 'interview' THEN 40
        WHEN 'offer_sent' THEN 50 WHEN 'token_paid' THEN 70
        WHEN 'pre_admitted' THEN 85 WHEN 'admitted' THEN 100 ELSE 0 END AS stage_points,
      CASE l.source::text WHEN 'walk_in' THEN 15 WHEN 'referral' THEN 10 WHEN 'website' THEN 5 ELSE 0 END AS source_points,
      CASE WHEN l.interview_score IS NULL THEN 0 ELSE least(l.interview_score / 2, 15) END AS interview_points,
      least(a.activity_count * 2, 20) AS activity_points,
      CASE WHEN now() - l.updated_at > interval '60 days' THEN -30
           WHEN now() - l.updated_at > interval '30 days' THEN -15 ELSE 0 END AS staleness_points,
      a.activity_count, l.stage::text AS stage, l.source::text AS source,
      l.interview_score, l.updated_at, l.lead_score, l.lead_temperature
    FROM lead_row l CROSS JOIN activity a
  )
  SELECT jsonb_build_object(
    'version', 'legacy-v1',
    'score', lead_score,
    'temperature', lead_temperature,
    'stage', stage,
    'updated_at', updated_at,
    'components', jsonb_build_array(
      jsonb_build_object('key', 'stage_progress', 'label', 'Admission stage', 'points', stage_points, 'detail', stage),
      jsonb_build_object('key', 'source', 'label', 'Lead source', 'points', source_points, 'detail', source),
      jsonb_build_object('key', 'interview', 'label', 'Interview score', 'points', interview_points, 'detail', interview_score),
      jsonb_build_object('key', 'activity', 'label', 'Recorded activity', 'points', activity_points, 'detail', activity_count || ' activities, capped at 20 points'),
      jsonb_build_object('key', 'staleness', 'label', 'Record freshness', 'points', staleness_points, 'detail', updated_at)
    ),
    'caveat', 'Legacy score mixes admission progress with conversion intent; it is for context and is not used for automated payout decisions.'
  ) FROM parts;
$$;

REVOKE ALL ON FUNCTION public.crm_lead_score_explanation(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.crm_lead_score_explanation(uuid) TO authenticated;

-- Keep a single accountable action distinct from supporting/visit reminders.
ALTER TABLE public.lead_followups
  ADD COLUMN IF NOT EXISTS is_primary boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS idempotency_key text;

WITH ranked_pending AS (
  SELECT id, row_number() OVER (PARTITION BY lead_id ORDER BY scheduled_at, created_at, id) AS position
  FROM public.lead_followups
  WHERE status = 'pending'
)
UPDATE public.lead_followups lf
SET is_primary = (rp.position = 1)
FROM ranked_pending rp
WHERE lf.id = rp.id AND lf.is_primary IS DISTINCT FROM (rp.position = 1);

CREATE UNIQUE INDEX IF NOT EXISTS lead_followups_one_primary_pending_per_lead
  ON public.lead_followups (lead_id)
  WHERE status = 'pending' AND is_primary;

CREATE UNIQUE INDEX IF NOT EXISTS lead_followups_idempotency_key_unique
  ON public.lead_followups (idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.lead_followup_owner_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  followup_id uuid NOT NULL REFERENCES public.lead_followups(id) ON DELETE CASCADE,
  previous_owner_user_id uuid REFERENCES auth.users(id),
  new_owner_user_id uuid REFERENCES auth.users(id),
  changed_by_user_id uuid REFERENCES auth.users(id),
  changed_at timestamptz NOT NULL DEFAULT now(),
  reason text NOT NULL DEFAULT 'Lead owner changed'
);

ALTER TABLE public.lead_followup_owner_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS lead_followup_owner_history_select ON public.lead_followup_owner_history;
CREATE POLICY lead_followup_owner_history_select ON public.lead_followup_owner_history
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'campus_admin') OR
    public.has_role(auth.uid(), 'principal') OR
    public.has_role(auth.uid(), 'vice_principal') OR
    public.has_role(auth.uid(), 'admission_head') OR
    previous_owner_user_id = auth.uid() OR new_owner_user_id = auth.uid()
  );

CREATE OR REPLACE FUNCTION public.transfer_open_followups_on_lead_reassignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_user_id uuid;
BEGIN
  IF NEW.counsellor_id IS NOT DISTINCT FROM OLD.counsellor_id THEN RETURN NEW; END IF;

  SELECT p.user_id INTO v_new_user_id
  FROM public.profiles p WHERE p.id = NEW.counsellor_id;

  INSERT INTO public.lead_followup_owner_history (
    lead_id, followup_id, previous_owner_user_id, new_owner_user_id,
    changed_by_user_id, reason
  )
  SELECT lf.lead_id, lf.id, lf.user_id, v_new_user_id, auth.uid(),
         'Lead owner changed from ' || COALESCE(OLD.counsellor_id::text, 'intake') ||
         ' to ' || COALESCE(NEW.counsellor_id::text, 'intake')
  FROM public.lead_followups lf
  WHERE lf.lead_id = NEW.id AND lf.status = 'pending'
    AND lf.user_id IS DISTINCT FROM v_new_user_id;

  UPDATE public.lead_followups
  SET user_id = v_new_user_id
  WHERE lead_id = NEW.id AND status = 'pending'
    AND user_id IS DISTINCT FROM v_new_user_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_transfer_open_followups_on_lead_reassignment ON public.leads;
CREATE TRIGGER trg_transfer_open_followups_on_lead_reassignment
  AFTER UPDATE OF counsellor_id ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.transfer_open_followups_on_lead_reassignment();
REVOKE ALL ON FUNCTION public.transfer_open_followups_on_lead_reassignment() FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.upsert_lead_primary_action(
  p_lead_id uuid,
  p_scheduled_at timestamptz,
  p_type text DEFAULT 'call',
  p_notes text DEFAULT NULL,
  p_idempotency_key text DEFAULT NULL,
  p_visit_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_profile_id uuid;
  v_owner_id uuid;
  v_stage text;
  v_archived_at timestamptz;
  v_is_manager boolean;
  v_action_id uuid;
BEGIN
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501'; END IF;
  IF p_scheduled_at IS NULL OR p_scheduled_at < now() - interval '1 year' THEN
    RAISE EXCEPTION 'A valid next-action time is required' USING ERRCODE = '22023';
  END IF;
  IF p_type IS NULL OR length(btrim(p_type)) = 0 THEN
    RAISE EXCEPTION 'Action type is required' USING ERRCODE = '22023';
  END IF;

  SELECT p.id INTO v_profile_id FROM public.profiles p WHERE p.user_id = v_user_id LIMIT 1;
  v_is_manager := public.has_role(v_user_id, 'super_admin') OR
                  public.has_role(v_user_id, 'campus_admin') OR
                  public.has_role(v_user_id, 'principal') OR
                  public.has_role(v_user_id, 'vice_principal') OR
                  public.has_role(v_user_id, 'admission_head');

  SELECT l.counsellor_id, l.stage::text, l.archived_at
  INTO v_owner_id, v_stage, v_archived_at
  FROM public.leads l WHERE l.id = p_lead_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Lead not found or not accessible' USING ERRCODE = 'P0002'; END IF;
  IF v_archived_at IS NOT NULL OR v_stage IN ('admitted', 'rejected', 'not_interested', 'ineligible', 'dnc', 'deferred', 'duplicate', 'course_not_available') THEN
    RAISE EXCEPTION 'A primary action cannot be scheduled for a terminal or archived lead' USING ERRCODE = '22023';
  END IF;
  IF NOT v_is_manager AND (v_profile_id IS NULL OR v_owner_id IS DISTINCT FROM v_profile_id) THEN
    RAISE EXCEPTION 'Only the assigned counsellor or a manager can set the primary action' USING ERRCODE = '42501';
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT lf.id INTO v_action_id FROM public.lead_followups lf
    WHERE lf.idempotency_key = p_idempotency_key AND lf.lead_id = p_lead_id LIMIT 1;
    IF v_action_id IS NOT NULL THEN RETURN v_action_id; END IF;
  END IF;

  SELECT lf.id INTO v_action_id FROM public.lead_followups lf
  WHERE lf.lead_id = p_lead_id AND lf.status = 'pending' AND lf.is_primary
  ORDER BY lf.scheduled_at, lf.created_at LIMIT 1 FOR UPDATE;

  IF v_action_id IS NULL THEN
    BEGIN
      INSERT INTO public.lead_followups (
        lead_id, user_id, scheduled_at, type, notes, status, is_primary, idempotency_key, visit_id
      ) VALUES (
        p_lead_id, v_user_id, p_scheduled_at, p_type, p_notes, 'pending', true, p_idempotency_key, p_visit_id
      ) RETURNING id INTO v_action_id;
    EXCEPTION WHEN unique_violation THEN
      IF p_idempotency_key IS NOT NULL THEN
        SELECT lf.id INTO v_action_id FROM public.lead_followups lf
        WHERE lf.idempotency_key = p_idempotency_key AND lf.lead_id = p_lead_id LIMIT 1;
        IF v_action_id IS NOT NULL THEN RETURN v_action_id; END IF;
      END IF;
      RAISE;
    END;
  ELSE
    UPDATE public.lead_followups
    SET scheduled_at = p_scheduled_at, type = p_type, notes = p_notes,
        user_id = v_user_id,
        idempotency_key = COALESCE(p_idempotency_key, idempotency_key),
        visit_id = p_visit_id
    WHERE id = v_action_id;
  END IF;
  RETURN v_action_id;
END;
$$;

REVOKE ALL ON FUNCTION public.upsert_lead_primary_action(uuid, timestamptz, text, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.upsert_lead_primary_action(uuid, timestamptz, text, text, text, uuid) TO authenticated;
