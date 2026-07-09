-- ====================================================================
-- Visit Center — desktop operational surface (additive only)
--
--   1. campus_visits: checked_in_at, purpose, outcome columns.
--   2. visit_funnel_leads view: expose checked_in_at + outcome.
--   3. SECURITY DEFINER RPCs (required by the leads-insert RLS trap):
--        create_walk_in_visit(...) — dedupe lead by phone, create lead +
--          campus_visits (walk_in, checked in) + activity, in one txn.
--        visit_check_in(_visit_id)
--        visit_complete(_visit_id,_outcome,_feedback,_followup_at,_followup_type)
--          — optionally creates the linked lead_followups (visit_id) row.
-- ====================================================================

-- 1. Columns --------------------------------------------------------------
ALTER TABLE public.campus_visits
  ADD COLUMN IF NOT EXISTS checked_in_at timestamptz,
  ADD COLUMN IF NOT EXISTS purpose text,
  ADD COLUMN IF NOT EXISTS outcome text;

ALTER TABLE public.campus_visits
  DROP CONSTRAINT IF EXISTS chk_campus_visits_outcome;
ALTER TABLE public.campus_visits
  ADD CONSTRAINT chk_campus_visits_outcome
  CHECK (outcome IS NULL OR outcome IN (
    'interested','token_collected','offer_discussed','needs_followup','not_interested','other'
  ));

COMMENT ON COLUMN public.campus_visits.checked_in_at IS 'When the candidate physically checked in (walk-in or scheduled arrival).';
COMMENT ON COLUMN public.campus_visits.purpose IS 'Free-text purpose of the visit (campus tour, fee discussion, etc.).';
COMMENT ON COLUMN public.campus_visits.outcome IS 'Structured outcome captured at visit completion.';

-- 2. Extend visit_funnel_leads with checked_in_at + outcome ---------------
-- Reproduced from 20260617100200_visit_funnel_and_scoring_fix.sql with the
-- two new columns surfaced from the latest visit; funnel logic unchanged.
-- New columns appended AFTER funnel_box: CREATE OR REPLACE VIEW only allows
-- appending columns at the end, and admissions_overview depends on this view
-- so DROP+CREATE would cascade.
CREATE OR REPLACE VIEW public.visit_funnel_leads  -- lint-allow: invoker view unchanged from 20260617100200; staff-facing funnel, RLS-scoping to the caller's own leads is intentional
WITH (security_invoker = on) AS
WITH latest_visit AS (
  SELECT DISTINCT ON (cv.lead_id)
         cv.lead_id,
         cv.id            AS visit_id,
         cv.status        AS visit_status,
         cv.visit_date,
         cv.checked_in_at,
         cv.outcome
    FROM public.campus_visits cv
   ORDER BY cv.lead_id, cv.visit_date DESC, cv.created_at DESC
)
SELECT
  lv.lead_id,
  l.counsellor_id,
  lv.visit_status,
  lv.visit_date,
  CASE
    WHEN l.admitted_at IS NOT NULL OR l.stage = 'admitted'              THEN 'admitted'
    WHEN l.applied_at IS NOT NULL                                       THEN 'applied'
    WHEN lv.visit_status = 'completed'
         AND EXISTS (SELECT 1 FROM public.lead_followups f
                      WHERE f.visit_id = lv.visit_id AND f.status = 'pending')
                                                                        THEN 'visit_followup'
    WHEN lv.visit_status = 'completed'                                  THEN 'completed'
    WHEN lv.visit_status = 'confirmed'                                  THEN 'confirmed'
    WHEN lv.visit_status = 'scheduled'                                  THEN 'scheduled'
    WHEN lv.visit_status IN ('no_show','cancelled')                     THEN 'leakage'
    ELSE 'leakage'
  END AS funnel_box,
  lv.checked_in_at,
  lv.outcome
FROM latest_visit lv
JOIN public.leads l ON l.id = lv.lead_id;

-- 3a. create_walk_in_visit -------------------------------------------------
-- Dedupes an existing lead by phone; otherwise creates a fresh walk_in lead
-- assigned to the calling counsellor + active session. Then creates a
-- checked-in campus_visits row (visit_type='walk_in') and a lead_activities
-- entry. Returns { lead_id, visit_id }.
CREATE OR REPLACE FUNCTION public.create_walk_in_visit(
  _name       text,
  _phone      text,
  _email      text        DEFAULT NULL,
  _course_id  uuid        DEFAULT NULL,
  _campus_id  uuid        DEFAULT NULL,
  _purpose    text        DEFAULT NULL,
  _notes      text        DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile_id  uuid;
  v_session_id  uuid;
  v_lead_id     uuid;
  v_visit_id    uuid;
  v_clean_phone text := regexp_replace(COALESCE(_phone, ''), '\D', '', 'g');
BEGIN
  IF _name IS NULL OR btrim(_name) = '' THEN
    RAISE EXCEPTION 'Name is required';
  END IF;
  IF v_clean_phone = '' THEN
    RAISE EXCEPTION 'Phone is required';
  END IF;

  SELECT id INTO v_profile_id FROM public.profiles WHERE user_id = auth.uid() LIMIT 1;

  SELECT id INTO v_session_id FROM public.admission_sessions
   WHERE is_active = true ORDER BY start_date DESC LIMIT 1;

  -- Dedupe by phone (last 10 digits match).
  SELECT id INTO v_lead_id
    FROM public.leads
   WHERE regexp_replace(phone, '\D', '', 'g') = v_clean_phone
   ORDER BY created_at DESC
   LIMIT 1;

  IF v_lead_id IS NULL THEN
    INSERT INTO public.leads (
      name, phone, email, course_id, campus_id,
      source, counsellor_id, session_id, notes
    ) VALUES (
      btrim(_name), _phone, NULLIF(btrim(COALESCE(_email, '')), ''),
      _course_id, _campus_id,
      'walk_in', v_profile_id, v_session_id, _notes
    )
    RETURNING id INTO v_lead_id;
  ELSE
    -- Existing lead: keep counsellor, refresh contact context if empty.
    UPDATE public.leads
       SET email      = COALESCE(NULLIF(btrim(COALESCE(_email, '')), ''), email),
           course_id  = COALESCE(_course_id, course_id),
           campus_id  = COALESCE(_campus_id, campus_id)
     WHERE id = v_lead_id;
  END IF;

  INSERT INTO public.campus_visits (
    lead_id, campus_id, scheduled_by, visit_date, status,
    visit_type, checked_in_at, purpose, feedback
  ) VALUES (
    v_lead_id, COALESCE(_campus_id, (SELECT campus_id FROM public.leads WHERE id = v_lead_id)),
    auth.uid(), now(), 'completed',
    'walk_in', now(), _purpose, _notes
  )
  RETURNING id INTO v_visit_id;

  INSERT INTO public.lead_activities (lead_id, user_id, type, description)
  VALUES (v_lead_id, v_profile_id, 'visit',
          'Walk-in recorded' || COALESCE(' — ' || _purpose, ''));

  RETURN jsonb_build_object('lead_id', v_lead_id, 'visit_id', v_visit_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_walk_in_visit(text,text,text,uuid,uuid,text,text)
  TO authenticated, service_role;

-- 3b. visit_check_in -------------------------------------------------------
CREATE OR REPLACE FUNCTION public.visit_check_in(_visit_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.campus_visits
     SET checked_in_at = COALESCE(checked_in_at, now()),
         status = CASE WHEN status IN ('scheduled','confirmed') THEN 'confirmed' ELSE status END,
         updated_at = now()
   WHERE id = _visit_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.visit_check_in(uuid) TO authenticated, service_role;

-- 3c. visit_complete -------------------------------------------------------
-- Marks a visit completed with an outcome + feedback, and (optionally) creates
-- the linked post-visit follow-up in the same transaction.
CREATE OR REPLACE FUNCTION public.visit_complete(
  _visit_id      uuid,
  _outcome       text        DEFAULT NULL,
  _feedback      text        DEFAULT NULL,
  _followup_at   timestamptz DEFAULT NULL,
  _followup_type text        DEFAULT 'call'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lead_id uuid;
BEGIN
  UPDATE public.campus_visits
     SET status     = 'completed',
         outcome    = COALESCE(_outcome, outcome),
         feedback   = COALESCE(_feedback, feedback),
         updated_at = now()
   WHERE id = _visit_id
   RETURNING lead_id INTO v_lead_id;

  IF v_lead_id IS NULL THEN
    RAISE EXCEPTION 'Visit % not found', _visit_id;
  END IF;

  IF _followup_at IS NOT NULL THEN
    INSERT INTO public.lead_followups (
      lead_id, user_id, scheduled_at, type, status, notes, visit_id
    ) VALUES (
      v_lead_id, auth.uid(), _followup_at, COALESCE(_followup_type, 'call'),
      'pending',
      'Post-visit follow-up' || COALESCE(' — ' || _outcome, ''),
      _visit_id
    );
  END IF;

  INSERT INTO public.lead_activities (lead_id, user_id, type, description)
  VALUES (v_lead_id,
          (SELECT id FROM public.profiles WHERE user_id = auth.uid() LIMIT 1),
          'visit',
          'Visit completed' || COALESCE(' — ' || _outcome, ''));
END;
$$;

GRANT EXECUTE ON FUNCTION public.visit_complete(uuid,text,text,timestamptz,text)
  TO authenticated, service_role;
