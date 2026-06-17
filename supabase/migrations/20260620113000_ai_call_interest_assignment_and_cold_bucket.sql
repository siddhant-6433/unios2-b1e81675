-- Route high-intent AI-call outcomes at the database boundary and keep cold,
-- unassigned AI-called leads available in the low-priority pickup bucket.

CREATE OR REPLACE FUNCTION public.fn_assign_priority_interested_lead(
  _lead_id uuid,
  _reason text DEFAULT 'priority_interested'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lead public.leads%ROWTYPE;
  v_assigned_to uuid;
  v_assigned_user_id uuid;
  v_assigned_name text;
  v_team_name text;
BEGIN
  SELECT * INTO v_lead
  FROM public.leads
  WHERE id = _lead_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  IF v_lead.stage IS DISTINCT FROM 'priority_interested'::public.lead_stage THEN
    RETURN NULL;
  END IF;

  IF COALESCE(v_lead.person_role, 'lead') <> 'lead'
     OR v_lead.stage IN ('not_interested', 'dnc', 'rejected', 'ineligible', 'admitted') THEN
    RETURN NULL;
  END IF;

  v_assigned_to := v_lead.counsellor_id;
  IF v_assigned_to IS NULL THEN
    v_assigned_to := public.fn_round_robin_assign_counsellor(_lead_id);
  END IF;

  IF v_assigned_to IS NULL THEN
    RETURN NULL;
  END IF;

  UPDATE public.leads
  SET assigned_at = COALESCE(assigned_at, now()),
      updated_at = now()
  WHERE id = _lead_id;

  SELECT user_id, display_name
  INTO v_assigned_user_id, v_assigned_name
  FROM public.profiles
  WHERE id = v_assigned_to;

  v_team_name := public.fn_team_for_lead(_lead_id);

  IF v_assigned_user_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM public.lead_followups f
       WHERE f.lead_id = _lead_id
         AND f.type = 'call'
         AND f.status = 'pending'
     ) THEN
    INSERT INTO public.lead_followups (lead_id, user_id, scheduled_at, type, status, notes)
    VALUES (
      _lead_id,
      v_assigned_user_id,
      now() + interval '30 minutes',
      'call',
      'pending',
      format('Priority interested lead auto-assigned to %s team. Reason: %s', COALESCE(v_team_name, 'admissions'), _reason)
    );
  END IF;

  IF v_assigned_user_id IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type, title, body, link, lead_id)
    VALUES (
      v_assigned_user_id,
      'lead_assigned',
      format('Priority interested lead assigned: %s', COALESCE(v_lead.name, 'Unknown')),
      'This lead is priority interested. Make first contact within 30 minutes.',
      '/admissions/' || _lead_id::text,
      _lead_id
    );
  END IF;

  INSERT INTO public.lead_activities (lead_id, type, description)
  VALUES (
    _lead_id,
    'system',
    format(
      'Priority interested lead auto-assigned to %s (%s). Reason: %s',
      COALESCE(v_assigned_name, 'counsellor'),
      COALESCE(v_team_name, 'admissions'),
      _reason
    )
  );

  RETURN v_assigned_to;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_assign_priority_interested_lead(uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_assign_priority_interested_on_stage()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.stage = 'priority_interested'::public.lead_stage
     AND NEW.counsellor_id IS NULL THEN
    PERFORM public.fn_assign_priority_interested_lead(NEW.id, 'stage became priority_interested');
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_assign_priority_interested_on_stage ON public.leads;
CREATE TRIGGER trg_assign_priority_interested_on_stage
  AFTER INSERT OR UPDATE OF stage ON public.leads
  FOR EACH ROW
  WHEN (NEW.stage = 'priority_interested'::public.lead_stage AND NEW.counsellor_id IS NULL)
  EXECUTE FUNCTION public.fn_assign_priority_interested_on_stage();

CREATE OR REPLACE FUNCTION public.fn_auto_elevate_priority_interested()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lead public.leads%ROWTYPE;
  v_disposition text := COALESCE(NEW.disposition, '');
  v_is_high_intent boolean := false;
  v_target_stage public.lead_stage;
  v_assigned_to uuid;
  v_assigned_user_id uuid;
  v_assigned_name text;
  v_team_name text;
BEGIN
  IF NEW.status <> 'completed' OR NEW.lead_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_lead
  FROM public.leads
  WHERE id = NEW.lead_id;

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  IF v_disposition = 'not_interested'
     AND v_lead.stage NOT IN ('not_interested', 'dnc', 'rejected', 'ineligible', 'admitted') THEN
    UPDATE public.leads
    SET stage = 'not_interested'::public.lead_stage,
        updated_at = now()
    WHERE id = NEW.lead_id;

    INSERT INTO public.lead_activities (lead_id, type, description)
    VALUES (NEW.lead_id, 'ai_call', 'AI call disposition: not_interested -> lead marked not_interested');

    RETURN NEW;
  ELSIF v_disposition = 'wrong_number'
     AND v_lead.stage NOT IN ('not_interested', 'dnc', 'rejected', 'ineligible', 'admitted') THEN
    UPDATE public.leads
    SET stage = 'dnc'::public.lead_stage,
        updated_at = now()
    WHERE id = NEW.lead_id;

    INSERT INTO public.lead_activities (lead_id, type, description)
    VALUES (NEW.lead_id, 'ai_call', 'AI call disposition: wrong_number -> lead marked dnc');

    RETURN NEW;
  END IF;

  v_is_high_intent := v_disposition IN ('interested', 'callback_requested')
    OR COALESCE(NEW.conversion_probability, 0) >= 60;

  IF NOT v_is_high_intent THEN
    RETURN NEW;
  END IF;

  IF v_lead.stage IN ('not_interested', 'dnc', 'rejected', 'ineligible', 'admitted') THEN
    RETURN NEW;
  END IF;

  v_assigned_to := public.fn_round_robin_assign_counsellor(NEW.lead_id);
  IF v_assigned_to IS NULL THEN
    RETURN NEW;
  END IF;

  v_target_stage := CASE
    WHEN COALESCE(NEW.conversion_probability, 0) >= 60 THEN 'priority_interested'::public.lead_stage
    ELSE 'counsellor_call'::public.lead_stage
  END;

  IF v_lead.stage IN ('new_lead', 'ai_called', 'counsellor_call', 'priority_interested', 'cold') THEN
    UPDATE public.leads
    SET stage = v_target_stage,
        assigned_at = COALESCE(assigned_at, now()),
        updated_at = now()
    WHERE id = NEW.lead_id;
  END IF;

  SELECT user_id, display_name
  INTO v_assigned_user_id, v_assigned_name
  FROM public.profiles
  WHERE id = v_assigned_to;

  v_team_name := public.fn_team_for_lead(NEW.lead_id);

  IF v_assigned_user_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM public.lead_followups f
       WHERE f.lead_id = NEW.lead_id
         AND f.type = 'call'
         AND f.status = 'pending'
     ) THEN
    INSERT INTO public.lead_followups (lead_id, user_id, scheduled_at, type, status, notes)
    VALUES (
      NEW.lead_id,
      v_assigned_user_id,
      now() + interval '30 minutes',
      'call',
      'pending',
      format(
        'AI call outcome: %s. Auto-assigned to %s team.',
        COALESCE(NULLIF(v_disposition, ''), COALESCE(NEW.conversion_probability::text || '% conversion', 'high intent')),
        COALESCE(v_team_name, 'admissions')
      )
    );
  END IF;

  IF v_assigned_user_id IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type, title, body, link, lead_id)
    VALUES (
      v_assigned_user_id,
      'lead_assigned',
      format('New lead assigned: %s', COALESCE(v_lead.name, 'Unknown')),
      format(
        'AI call outcome: %s. Follow up within 30 minutes.',
        COALESCE(NULLIF(v_disposition, ''), COALESCE(NEW.conversion_probability::text || '% conversion', 'high intent'))
      ),
      '/admissions/' || NEW.lead_id::text,
      NEW.lead_id
    );
  END IF;

  INSERT INTO public.lead_activities (lead_id, type, description)
  VALUES (
    NEW.lead_id,
    'system',
    format(
      'Auto-assigned to %s (%s) after AI call (%s)',
      COALESCE(v_assigned_name, 'counsellor'),
      COALESCE(v_team_name, 'admissions'),
      COALESCE(NULLIF(v_disposition, ''), COALESCE(NEW.conversion_probability::text || '% conversion', 'high intent'))
    )
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_elevate_priority_interested ON public.ai_call_records;
CREATE TRIGGER trg_auto_elevate_priority_interested
  AFTER INSERT OR UPDATE OF status, conversion_probability, disposition ON public.ai_call_records
  FOR EACH ROW EXECUTE FUNCTION public.fn_auto_elevate_priority_interested();

CREATE OR REPLACE FUNCTION public.get_unassigned_leads_bucket()
RETURNS TABLE (
  id uuid,
  name text,
  phone text,
  email text,
  stage text,
  source text,
  course_id uuid,
  campus_id uuid,
  created_at timestamptz,
  lead_score integer,
  lead_temperature text,
  course_name text,
  campus_name text,
  bucket text,
  school_brand text,
  jd_category text,
  last_ai_summary text,
  last_ai_disposition text,
  last_ai_conversion_pct integer,
  has_paid_or_submitted_application boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH classified AS (
    SELECT
      l.id,
      l.name,
      l.phone,
      l.email,
      l.stage::text                                AS stage,
      l.source::text                               AS source,
      l.course_id,
      l.campus_id,
      l.created_at,
      l.lead_score,
      l.lead_temperature,
      c.name                                       AS course_name,
      cam.name                                     AS campus_name,
      l.jd_category                                AS jd_category,
      EXISTS (
        SELECT 1
        FROM public.applications a
        WHERE a.lead_id = l.id
          AND (
            a.payment_status = 'paid'
            OR a.submitted_at IS NOT NULL
            OR COALESCE(a.status, 'draft') NOT IN ('draft', 'in_progress')
          )
      )                                            AS has_paid_or_submitted_application,
      CASE
        WHEN i.type IS NOT NULL          THEN i.type
        WHEN cam_inst.type = 'school'    THEN 'school'
        WHEN jdm.is_school = true        THEN 'school'
        ELSE 'college'
      END                                          AS bucket
    FROM public.leads l
    LEFT JOIN public.courses c            ON c.id = l.course_id
    LEFT JOIN public.departments d        ON d.id = c.department_id
    LEFT JOIN public.institutions i       ON i.id = d.institution_id
    LEFT JOIN public.campuses cam         ON cam.id = l.campus_id
    LEFT JOIN public.institutions cam_inst
      ON cam_inst.campus_id = l.campus_id
      AND cam_inst.type = 'school'
    LEFT JOIN public.jd_category_mappings jdm
      ON lower(jdm.category) = lower(l.jd_category)
    WHERE l.counsellor_id IS NULL
      AND l.stage NOT IN ('admitted', 'rejected', 'not_interested', 'dnc', 'ineligible')
      AND l.is_mirror = false
      AND COALESCE(l.person_role, 'lead') = 'lead'
  ),
  latest_ai AS (
    SELECT DISTINCT ON (lead_id)
      lead_id,
      summary,
      disposition,
      conversion_probability
    FROM public.ai_call_records
    WHERE summary IS NOT NULL
    ORDER BY lead_id, created_at DESC
  )
  SELECT
    cl.id, cl.name, cl.phone, cl.email, cl.stage, cl.source,
    cl.course_id, cl.campus_id, cl.created_at,
    cl.lead_score, cl.lead_temperature, cl.course_name, cl.campus_name,
    cl.bucket,
    CASE
      WHEN cl.bucket <> 'school' THEN NULL
      WHEN cl.campus_id = 'c0000002-0000-0000-0000-000000000001'::uuid THEN 'mirai'
      ELSE 'nimt'
    END AS school_brand,
    cl.jd_category,
    la.summary                                          AS last_ai_summary,
    la.disposition                                      AS last_ai_disposition,
    la.conversion_probability::int                      AS last_ai_conversion_pct,
    cl.has_paid_or_submitted_application
  FROM classified cl
  LEFT JOIN latest_ai la ON la.lead_id = cl.id;
$$;

GRANT EXECUTE ON FUNCTION public.get_unassigned_leads_bucket() TO authenticated;

DO $$
DECLARE
  r record;
  v_assigned uuid;
BEGIN
  FOR r IN
    SELECT DISTINCT ON (acr.lead_id)
      acr.lead_id,
      acr.disposition,
      acr.conversion_probability
    FROM public.ai_call_records acr
    JOIN public.leads l ON l.id = acr.lead_id
    WHERE acr.lead_id IS NOT NULL
      AND acr.status = 'completed'
      AND l.counsellor_id IS NULL
      AND l.stage NOT IN ('not_interested', 'dnc', 'rejected', 'ineligible', 'admitted')
      AND (
        acr.disposition IN ('interested', 'callback_requested')
        OR COALESCE(acr.conversion_probability, 0) >= 60
      )
    ORDER BY acr.lead_id, acr.created_at DESC
  LOOP
    v_assigned := public.fn_round_robin_assign_counsellor(r.lead_id);
    IF v_assigned IS NOT NULL THEN
      UPDATE public.leads
      SET stage = CASE
            WHEN COALESCE(r.conversion_probability, 0) >= 60
              THEN 'priority_interested'::public.lead_stage
            ELSE 'counsellor_call'::public.lead_stage
          END,
          assigned_at = COALESCE(assigned_at, now()),
          updated_at = now()
      WHERE id = r.lead_id;

      IF COALESCE(r.conversion_probability, 0) >= 60 THEN
        PERFORM public.fn_assign_priority_interested_lead(r.lead_id, 'high-intent AI call backfill');
      END IF;
    END IF;
  END LOOP;
END $$;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT id
    FROM public.leads
    WHERE stage = 'priority_interested'::public.lead_stage
      AND counsellor_id IS NULL
      AND is_mirror = false
      AND COALESCE(person_role, 'lead') = 'lead'
  LOOP
    PERFORM public.fn_assign_priority_interested_lead(r.id, 'existing priority_interested backfill');
  END LOOP;
END $$;
