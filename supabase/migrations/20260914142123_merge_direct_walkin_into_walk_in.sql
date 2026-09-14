-- Merge Direct Walk-In into Walk-in, and treat Record Walk-in as desk
-- presence (reuse an open visit; optional already-left checkout).
--
-- Postgres cannot cheaply drop enum values, so `direct_walkin` stays on
-- lead_source. Rows and UI collapse onto walk_in.

-- 1. Remap existing leads. trg_lock_lead_source allows auth.uid() IS NULL
--    (migration / service role) and still writes lead_source_audit.
UPDATE public.leads
   SET source = 'walk_in'
 WHERE source = 'direct_walkin';

-- 2. Current incentive_config: drop the retired source from the walk-in class.
--    Both already paid 50%; this only stops listing a dead label.
UPDATE public.incentive_config ic
   SET config = jsonb_set(
         ic.config,
         '{source_classes,walk_in,sources}',
         '["walk_in"]'::jsonb
       )
 WHERE ic.version = (SELECT MAX(version) FROM public.incentive_config)
   AND COALESCE(ic.config #>> '{source_classes,walk_in,sources}', '') LIKE '%direct_walkin%';

-- 3. Recreate create_walk_in_visit: walk_in only, reuse open visit, already-left.
DROP FUNCTION IF EXISTS public.create_walk_in_visit(text, text, text, uuid, uuid, text, text);
DROP FUNCTION IF EXISTS public.create_walk_in_visit(text, text, text, uuid, uuid, text, text, lead_source);
DROP FUNCTION IF EXISTS public.create_walk_in_visit(text, text, text, uuid, uuid, text, text, lead_source, boolean);

CREATE OR REPLACE FUNCTION public.create_walk_in_visit(
  _name          text,
  _phone         text,
  _email         text        DEFAULT NULL,
  _course_id     uuid        DEFAULT NULL,
  _campus_id     uuid        DEFAULT NULL,
  _purpose       text        DEFAULT NULL,
  _notes         text        DEFAULT NULL,
  _source        lead_source DEFAULT 'walk_in',
  _already_left  boolean     DEFAULT false
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
  v_already_open boolean := false;
  v_clean_phone text := regexp_replace(COALESCE(_phone, ''), '\D', '', 'g');
BEGIN
  IF _name IS NULL OR btrim(_name) = '' THEN
    RAISE EXCEPTION 'Name is required';
  END IF;
  IF v_clean_phone = '' THEN
    RAISE EXCEPTION 'Phone is required';
  END IF;
  IF _source IS DISTINCT FROM 'walk_in' THEN
    RAISE EXCEPTION 'Walk-in source must be walk_in';
  END IF;

  SELECT id INTO v_profile_id FROM public.profiles WHERE user_id = auth.uid() LIMIT 1;

  SELECT id INTO v_session_id FROM public.admission_sessions
   WHERE is_active = true ORDER BY start_date DESC LIMIT 1;

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
    -- Existing lead keeps its source (digital/consultant walk-ins stay attributed).
    UPDATE public.leads
       SET email      = COALESCE(NULLIF(btrim(COALESCE(_email, '')), ''), email),
           course_id  = COALESCE(_course_id, course_id),
           campus_id  = COALESCE(_campus_id, campus_id)
     WHERE id = v_lead_id;
  END IF;

  SELECT id INTO v_visit_id
    FROM public.campus_visits
   WHERE lead_id = v_lead_id
     AND visit_type = 'walk_in'
     AND checked_out_at IS NULL
     AND checked_in_at IS NOT NULL
   ORDER BY checked_in_at DESC
   LIMIT 1;

  IF v_visit_id IS NOT NULL THEN
    v_already_open := true;
  ELSE
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
    VALUES (
      v_lead_id, v_profile_id, 'visit',
      'Walk-in recorded' || COALESCE(' — ' || _purpose, '')
    );
  END IF;

  IF _already_left THEN
    UPDATE public.campus_visits
       SET checked_out_at = COALESCE(checked_out_at, now())
     WHERE id = v_visit_id
       AND checked_out_at IS NULL;
    IF FOUND THEN
      INSERT INTO public.lead_activities (lead_id, user_id, type, description)
      VALUES (v_lead_id, v_profile_id, 'visit', 'Visitor checked out');
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'lead_id', v_lead_id,
    'visit_id', v_visit_id,
    'already_open', v_already_open,
    'already_left', _already_left
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_walk_in_visit(text, text, text, uuid, uuid, text, text, lead_source, boolean)
  TO authenticated, service_role;
