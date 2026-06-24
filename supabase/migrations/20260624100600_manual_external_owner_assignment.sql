-- Manual external owner assignment for consultant / academic partner attribution.
-- Counsellor assignment remains separate and continues to drive admissions follow-up.

CREATE OR REPLACE FUNCTION public.can_academic_partner_view_mapped_lead(_user_id uuid, _lead_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.leads l
    JOIN public.academic_partners ap ON ap.id = l.academic_partner_id
    WHERE l.id = _lead_id
      AND ap.user_id = _user_id
      AND ap.status = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION public.can_academic_partner_view_fee_student(_user_id uuid, _student_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.students s
    JOIN public.leads l ON l.id = s.lead_id
    JOIN public.academic_partners ap ON ap.id = l.academic_partner_id
    WHERE s.id = _student_id
      AND ap.user_id = _user_id
      AND ap.status = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION public.can_view_lead(_user_id uuid, _lead_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 WHERE has_role(_user_id, 'super_admin')
      OR has_role(_user_id, 'campus_admin')
      OR has_role(_user_id, 'admission_head')
      OR has_role(_user_id, 'principal')
      OR has_role(_user_id, 'data_entry')
  )
  OR EXISTS (
    SELECT 1 FROM public.leads l
    JOIN public.profiles p ON p.id = l.counsellor_id
    WHERE l.id = _lead_id AND p.user_id = _user_id
  )
  OR EXISTS (
    SELECT 1 FROM public.lead_counsellors lc
    JOIN public.profiles p ON p.id = lc.counsellor_id
    WHERE lc.lead_id = _lead_id AND p.user_id = _user_id
  )
  OR EXISTS (
    SELECT 1 FROM public.teams t
    JOIN public.profiles leader_p ON leader_p.id = t.leader_id AND leader_p.user_id = _user_id
    JOIN public.team_members tm ON tm.team_id = t.id
    WHERE EXISTS (
      SELECT 1 FROM public.leads l
      JOIN public.profiles mp ON mp.user_id = tm.user_id AND mp.id = l.counsellor_id
      WHERE l.id = _lead_id
    )
    OR EXISTS (
      SELECT 1 FROM public.lead_counsellors lc
      JOIN public.profiles mp ON mp.user_id = tm.user_id AND mp.id = lc.counsellor_id
      WHERE lc.lead_id = _lead_id
    )
  )
  OR EXISTS (
    SELECT 1 FROM public.publishers pb
    JOIN public.leads l ON l.source::text = pb.source
    WHERE pb.user_id = _user_id AND pb.is_active = true AND l.id = _lead_id
  )
  OR public.can_academic_partner_view_mapped_lead(_user_id, _lead_id)
$$;

CREATE OR REPLACE FUNCTION public.assign_lead_external_owner(
  _lead_id uuid,
  _owner_type text,
  _consultant_id uuid DEFAULT NULL,
  _academic_partner_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_actor_profile_id uuid;
  v_old_consultant_id uuid;
  v_old_academic_partner_id uuid;
  v_old_owner text := 'None';
  v_new_owner text := 'None';
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid, 'super_admin'::app_role) THEN
    RAISE EXCEPTION 'Only super admins can assign lead external owners';
  END IF;

  SELECT consultant_id, academic_partner_id
    INTO v_old_consultant_id, v_old_academic_partner_id
  FROM public.leads
  WHERE id = _lead_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lead not found';
  END IF;

  IF v_old_consultant_id IS NOT NULL THEN
    SELECT 'Consultant: ' || name INTO v_old_owner
    FROM public.consultants
    WHERE id = v_old_consultant_id;
  ELSIF v_old_academic_partner_id IS NOT NULL THEN
    SELECT 'Academic Partner: ' || name INTO v_old_owner
    FROM public.academic_partners
    WHERE id = v_old_academic_partner_id;
  END IF;

  SELECT id INTO v_actor_profile_id
  FROM public.profiles
  WHERE user_id = v_uid
  LIMIT 1;

  IF _owner_type = 'consultant' THEN
    IF _consultant_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.consultants
      WHERE id = _consultant_id AND stage <> 'inactive'
    ) THEN
      RAISE EXCEPTION 'Invalid or inactive consultant';
    END IF;

    SELECT 'Consultant: ' || name INTO v_new_owner
    FROM public.consultants
    WHERE id = _consultant_id;

    UPDATE public.leads
    SET consultant_id = _consultant_id,
        academic_partner_id = NULL,
        source = 'consultant'::lead_source,
        updated_at = now()
    WHERE id = _lead_id;
  ELSIF _owner_type = 'academic_partner' THEN
    IF _academic_partner_id IS NULL OR NOT EXISTS (
      SELECT 1 FROM public.academic_partners
      WHERE id = _academic_partner_id AND status = 'active'
    ) THEN
      RAISE EXCEPTION 'Invalid or inactive academic partner';
    END IF;

    SELECT 'Academic Partner: ' || name INTO v_new_owner
    FROM public.academic_partners
    WHERE id = _academic_partner_id;

    UPDATE public.leads
    SET consultant_id = NULL,
        academic_partner_id = _academic_partner_id,
        source = 'academic_partner'::lead_source,
        updated_at = now()
    WHERE id = _lead_id;
  ELSIF _owner_type = 'none' THEN
    UPDATE public.leads
    SET consultant_id = NULL,
        academic_partner_id = NULL,
        updated_at = now()
    WHERE id = _lead_id;
  ELSE
    RAISE EXCEPTION 'Invalid owner type';
  END IF;

  IF v_old_owner IS DISTINCT FROM v_new_owner THEN
    INSERT INTO public.lead_activities (lead_id, user_id, type, description)
    VALUES (
      _lead_id,
      v_actor_profile_id,
      'info_update',
      'External owner changed from "' || COALESCE(v_old_owner, 'None') || '" to "' || COALESCE(v_new_owner, 'None') || '"'
    );
  END IF;

  RETURN jsonb_build_object(
    'status', 'updated',
    'lead_id', _lead_id,
    'owner_type', _owner_type,
    'old_owner', COALESCE(v_old_owner, 'None'),
    'new_owner', COALESCE(v_new_owner, 'None')
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.lead_detail(p_lead_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
WITH
  lead_row AS (
    SELECT
      to_jsonb(l) || jsonb_build_object(
        'lead_course',     CASE WHEN c.id IS NULL THEN NULL
                                ELSE jsonb_build_object('name', c.name, 'duration_years', c.duration_years, 'type', c.type) END,
        'lead_campus',     CASE WHEN cmp.id IS NULL THEN NULL
                                ELSE jsonb_build_object('name', cmp.name, 'city', cmp.city, 'state', cmp.state) END,
        'lead_counsellor', CASE WHEN p.id IS NULL THEN NULL
                                ELSE jsonb_build_object('display_name', p.display_name) END,
        'lead_consultant', CASE WHEN con.id IS NULL THEN NULL
                                ELSE jsonb_build_object('id', con.id, 'name', con.name, 'organization', con.organization) END,
        'lead_academic_partner', CASE WHEN ap.id IS NULL THEN NULL
                                      ELSE jsonb_build_object('id', ap.id, 'name', ap.name, 'organization', ap.organization) END
      ) AS row
    FROM public.leads l
    LEFT JOIN public.courses   c   ON c.id   = l.course_id
    LEFT JOIN public.campuses  cmp ON cmp.id = l.campus_id
    LEFT JOIN public.profiles  p   ON p.id   = l.counsellor_id
    LEFT JOIN public.consultants con ON con.id = l.consultant_id
    LEFT JOIN public.academic_partners ap ON ap.id = l.academic_partner_id
    WHERE l.id = p_lead_id
  ),
  notes_arr AS (
    SELECT jsonb_agg(to_jsonb(n) ORDER BY n.created_at DESC) AS rows
    FROM (
      SELECT * FROM public.lead_notes WHERE lead_id = p_lead_id
      ORDER BY created_at DESC LIMIT 50
    ) n
  ),
  followups_arr AS (
    SELECT jsonb_agg(to_jsonb(f) ORDER BY f.scheduled_at ASC) AS rows
    FROM (
      SELECT * FROM public.lead_followups WHERE lead_id = p_lead_id
      ORDER BY scheduled_at ASC LIMIT 30
    ) f
  ),
  visits_arr AS (
    SELECT jsonb_agg(to_jsonb(v) ORDER BY v.visit_date DESC) AS rows
    FROM (
      SELECT * FROM public.campus_visits WHERE lead_id = p_lead_id
      ORDER BY visit_date DESC LIMIT 20
    ) v
  ),
  activities_arr AS (
    SELECT jsonb_agg(to_jsonb(a) ORDER BY a.created_at DESC) AS rows
    FROM (
      SELECT * FROM public.lead_activities WHERE lead_id = p_lead_id
      ORDER BY created_at DESC LIMIT 50
    ) a
  ),
  call_logs_arr AS (
    SELECT jsonb_agg(to_jsonb(cl) ORDER BY cl.called_at DESC) AS rows
    FROM (
      SELECT * FROM public.call_logs WHERE lead_id = p_lead_id
      ORDER BY called_at DESC LIMIT 20
    ) cl
  )
SELECT jsonb_build_object(
  'lead',       (SELECT row  FROM lead_row),
  'notes',      COALESCE((SELECT rows FROM notes_arr),      '[]'::jsonb),
  'followups',  COALESCE((SELECT rows FROM followups_arr),  '[]'::jsonb),
  'visits',     COALESCE((SELECT rows FROM visits_arr),     '[]'::jsonb),
  'activities', COALESCE((SELECT rows FROM activities_arr), '[]'::jsonb),
  'call_logs',  COALESCE((SELECT rows FROM call_logs_arr),  '[]'::jsonb)
);
$$;

CREATE OR REPLACE VIEW public.academic_partner_dashboard AS
SELECT
  ap.id AS partner_id,
  ap.user_id,
  ap.name AS partner_name,
  ap.organization,
  ap.phone,
  ap.email,
  ap.status,
  ap.default_payout_percentage,
  (SELECT COUNT(DISTINCT apa.course_id)
     FROM public.academic_partner_assignments apa
    WHERE apa.partner_id = ap.id AND apa.is_active = true) AS assigned_courses,
  (SELECT COUNT(DISTINCT apa.batch_id)
     FROM public.academic_partner_assignments apa
    WHERE apa.partner_id = ap.id AND apa.batch_id IS NOT NULL AND apa.is_active = true) AS assigned_batches,
  (SELECT COUNT(*)
     FROM public.leads l
    WHERE l.academic_partner_id = ap.id) AS total_leads,
  (SELECT COUNT(*)
     FROM public.leads l
    WHERE l.academic_partner_id = ap.id AND l.stage = 'admitted') AS conversions,
  (SELECT COUNT(*)
     FROM public.leads l
    WHERE l.academic_partner_id = ap.id AND l.stage NOT IN ('rejected', 'admitted')) AS pipeline,
  (SELECT COUNT(DISTINCT s.id)
     FROM public.students s
    WHERE EXISTS (
      SELECT 1 FROM public.academic_partner_assignments apa
      WHERE apa.partner_id = ap.id
        AND apa.is_active = true
        AND apa.course_id = s.course_id
        AND (apa.batch_id IS NULL OR apa.batch_id = s.batch_id)
    )) AS total_candidates,
  COALESCE((SELECT SUM(fl.paid_amount)
     FROM public.fee_ledger fl
     JOIN public.students s ON s.id = fl.student_id
     JOIN public.leads l ON l.id = s.lead_id AND l.academic_partner_id = ap.id
    ), 0)::numeric(12,2) AS total_fee_collected,
  COALESCE((SELECT SUM(app.payout_amount)
     FROM public.academic_partner_payouts app
    WHERE app.partner_id = ap.id AND app.status IN ('pending', 'approved', 'paid')), 0)::numeric(12,2) AS total_payout,
  COALESCE((SELECT SUM(app.payout_amount)
     FROM public.academic_partner_payouts app
    WHERE app.partner_id = ap.id AND app.status IN ('pending', 'approved')), 0)::numeric(12,2) AS pending_payout,
  COALESCE((SELECT SUM(app.payout_amount)
     FROM public.academic_partner_payouts app
    WHERE app.partner_id = ap.id AND app.status = 'paid'), 0)::numeric(12,2) AS paid_payout
FROM public.academic_partners ap;

CREATE OR REPLACE VIEW public.academic_partner_assignment_summary AS
SELECT
  apa.id,
  apa.partner_id,
  apa.course_id,
  c.name AS course_name,
  apa.batch_id,
  b.name AS batch_name,
  apa.payout_percentage,
  COALESCE(apa.payout_percentage, ap.default_payout_percentage) AS effective_payout_percentage,
  apa.is_active,
  COUNT(DISTINCT s.id) AS candidates,
  COALESCE(SUM(fl.paid_amount), 0)::numeric(12,2) AS fee_collected
FROM public.academic_partner_assignments apa
JOIN public.academic_partners ap ON ap.id = apa.partner_id
JOIN public.courses c ON c.id = apa.course_id
LEFT JOIN public.batches b ON b.id = apa.batch_id
LEFT JOIN public.students s ON s.course_id = apa.course_id AND (apa.batch_id IS NULL OR s.batch_id = apa.batch_id)
LEFT JOIN public.leads l ON l.id = s.lead_id AND l.academic_partner_id = apa.partner_id
LEFT JOIN public.fee_ledger fl ON fl.student_id = s.id AND l.id IS NOT NULL
GROUP BY apa.id, apa.partner_id, apa.course_id, c.name, apa.batch_id, b.name, apa.payout_percentage, ap.default_payout_percentage, apa.is_active;

DROP POLICY IF EXISTS "Academic partners view own leads" ON public.leads;
CREATE POLICY "Academic partners view own leads"
  ON public.leads FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'academic_partner'::app_role)
    AND public.can_academic_partner_view_mapped_lead(auth.uid(), id)
  );

DROP POLICY IF EXISTS "Academic partners view own lead activities" ON public.lead_activities;
CREATE POLICY "Academic partners view own lead activities"
  ON public.lead_activities FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'academic_partner'::app_role)
    AND public.can_academic_partner_view_mapped_lead(auth.uid(), lead_id)
  );

DROP POLICY IF EXISTS "Academic partners insert own lead activities" ON public.lead_activities;
CREATE POLICY "Academic partners insert own lead activities"
  ON public.lead_activities FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'academic_partner'::app_role)
    AND public.can_academic_partner_view_mapped_lead(auth.uid(), lead_id)
  );

DROP POLICY IF EXISTS "Academic partners view assigned fee ledger" ON public.fee_ledger;
DROP POLICY IF EXISTS "Academic partners view mapped fee ledger" ON public.fee_ledger;
CREATE POLICY "Academic partners view mapped fee ledger"
  ON public.fee_ledger FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'academic_partner'::app_role)
    AND public.can_academic_partner_view_fee_student(auth.uid(), student_id)
  );

DROP POLICY IF EXISTS "Academic partners view assigned payments" ON public.payments;
DROP POLICY IF EXISTS "Academic partners view mapped payments" ON public.payments;
CREATE POLICY "Academic partners view mapped payments"
  ON public.payments FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'academic_partner'::app_role)
    AND public.can_academic_partner_view_fee_student(auth.uid(), student_id)
  );

DROP POLICY IF EXISTS "Academic partners view assigned ledger payments" ON public.fee_ledger_payments;
DROP POLICY IF EXISTS "Academic partners view mapped ledger payments" ON public.fee_ledger_payments;
CREATE POLICY "Academic partners view mapped ledger payments"
  ON public.fee_ledger_payments FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'academic_partner'::app_role)
    AND EXISTS (
      SELECT 1
      FROM public.fee_ledger fl
      WHERE fl.id = fee_ledger_payments.fee_ledger_id
        AND public.can_academic_partner_view_fee_student(auth.uid(), fl.student_id)
    )
  );

DROP POLICY IF EXISTS "Academic partners view assigned applications" ON public.applications;
DROP POLICY IF EXISTS "Academic partners view mapped applications" ON public.applications;
CREATE POLICY "Academic partners view mapped applications"
  ON public.applications FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'academic_partner'::app_role)
    AND lead_id IS NOT NULL
    AND public.can_academic_partner_view_mapped_lead(auth.uid(), lead_id)
  );

GRANT EXECUTE ON FUNCTION public.can_academic_partner_view_mapped_lead(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_academic_partner_view_fee_student(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.assign_lead_external_owner(uuid, text, uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.lead_detail(uuid) TO authenticated;
