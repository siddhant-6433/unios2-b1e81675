-- Follow-up to 20260807105622: _partner_id now defaults to the Stetho row,
-- resolved server-side (most staff roles cannot SELECT academic_partners).
-- Idempotent CREATE OR REPLACEs, identical to the bodies in that migration.

-- notifications.type is CHECK-constrained; add the referral outcome type the
-- same way every other feature has (widen the list, never drop it).
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check CHECK (
  type = ANY (ARRAY[
    'lead_assigned', 'sla_warning', 'lead_reclaimed', 'followup_due', 'followup_overdue',
    'visit_confirmation_due', 'visit_followup_due', 'lead_transferred', 'deletion_request',
    'whatsapp_message', 'whatsapp_sla_warning', 'whatsapp_sla_breach', 'approval_pending',
    'approval_decided', 'template_status_update', 'tat_defaults_report', 'post_visit_nudge',
    'score_penalty', 'lead_bucket_backlog', 'feedback_received', 'campaign_completed',
    'student_service_assigned', 'student_service_unassigned', 'pgdm_certificate_pending',
    'pgdm_certificate_approved', 'pgdm_diploma_ready', 'general', 'visit_due', 'missed_call',
    'callback_requested', 'notice_published', 'gatepass_update', 'assignment_due',
    'substitution_assigned', 'leave_decision', 'hostel_alert', 'approval_request',
    'payment_receipt', 'finance_audit_anomaly', 'partner_referral_outcome'
  ])
);

-- Staff action: refer a BPT/BMRIT lead to an active partner. Idempotent.
-- _partner_id NULL resolves to the referral partner (Stetho). Resolved here rather
-- than in the frontend because most staff roles cannot SELECT academic_partners,
-- and so we never hardcode a UUID in app code.
CREATE OR REPLACE FUNCTION public.refer_lead_to_partner(
  _lead_id uuid,
  _partner_id uuid DEFAULT NULL,
  _note text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_course_id uuid;
  v_lead_name text;
  v_partner_id uuid := _partner_id;
  v_partner_name text;
  v_actor_name text;
  v_actor_profile_id uuid;
  v_referral_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT public.can_view_lead(v_uid, _lead_id) THEN
    RAISE EXCEPTION 'Not allowed to refer this lead';
  END IF;

  SELECT l.course_id, l.name INTO v_course_id, v_lead_name
  FROM public.leads l WHERE l.id = _lead_id;

  IF v_lead_name IS NULL THEN
    RAISE EXCEPTION 'Lead not found';
  END IF;

  -- BPT/BMRIT gate lives here, not only in the UI.
  IF v_course_id IS NULL OR NOT public.is_bpt_or_bmrit_course(v_course_id) THEN
    RAISE EXCEPTION 'Only BPT / BMRIT leads can be referred';
  END IF;

  IF v_partner_id IS NULL THEN
    SELECT ap.id, COALESCE(ap.organization, ap.name) INTO v_partner_id, v_partner_name
    FROM public.academic_partners ap
    WHERE ap.status = 'active'
      AND (ap.pan_number = 'ABTCS6641J' OR ap.organization ILIKE '%stetho%' OR ap.name ILIKE '%stetho%')
    ORDER BY (ap.pan_number = 'ABTCS6641J') DESC
    LIMIT 1;

    IF v_partner_id IS NULL THEN
      RAISE EXCEPTION 'Referral partner (Stetho) is not configured';
    END IF;
  ELSE
    SELECT COALESCE(ap.organization, ap.name) INTO v_partner_name
    FROM public.academic_partners ap
    WHERE ap.id = v_partner_id AND ap.status = 'active';

    IF v_partner_name IS NULL THEN
      RAISE EXCEPTION 'Partner not found or inactive';
    END IF;
  END IF;

  SELECT p.id, COALESCE(p.display_name, 'Staff') INTO v_actor_profile_id, v_actor_name
  FROM public.profiles p WHERE p.user_id = v_uid;

  SELECT id INTO v_referral_id
  FROM public.lead_referrals
  WHERE lead_id = _lead_id AND partner_id = v_partner_id;

  IF v_referral_id IS NOT NULL THEN
    RETURN v_referral_id;
  END IF;

  INSERT INTO public.lead_referrals (lead_id, partner_id, referred_by, referred_by_name, referral_note)
  VALUES (_lead_id, v_partner_id, v_uid, v_actor_name, NULLIF(_note, ''))
  ON CONFLICT (lead_id, partner_id) DO NOTHING
  RETURNING id INTO v_referral_id;

  IF v_referral_id IS NULL THEN
    SELECT id INTO v_referral_id
    FROM public.lead_referrals
    WHERE lead_id = _lead_id AND partner_id = v_partner_id;
    RETURN v_referral_id;
  END IF;

  -- lead_activities.type is CHECK-constrained and user_id FKs profiles(id),
  -- so a referral is logged as an 'assignment' by the acting staff profile.
  INSERT INTO public.lead_activities (lead_id, type, description, user_id)
  VALUES (
    _lead_id,
    'assignment',
    COALESCE(v_actor_name, 'Staff') || ' referred this lead to ' || v_partner_name
      || CASE WHEN COALESCE(_note, '') <> '' THEN ': ' || _note ELSE '' END,
    v_actor_profile_id
  );

  RETURN v_referral_id;
END;
$$;

-- Partner action: update the outcome of a referral.
CREATE OR REPLACE FUNCTION public.academic_partner_update_referral(
  _referral_id uuid,
  _status text,
  _notes text DEFAULT NULL,
  _partner_id uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_partner_id uuid;
  v_partner_name text;
  v_lead_id uuid;
  v_lead_name text;
  v_actor_profile_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF _status NOT IN ('pending', 'contacted', 'not_reachable', 'admitted', 'not_admitted') THEN
    RAISE EXCEPTION 'Invalid referral status: %', _status;
  END IF;

  -- Same impersonation guard as academic_partner_lead_funnel_signals: an explicit
  -- _partner_id is only honoured for super_admin (the UI impersonation path).
  IF _partner_id IS NOT NULL THEN
    IF NOT public.has_role(v_uid, 'super_admin'::app_role) THEN
      RAISE EXCEPTION 'Not allowed';
    END IF;
    SELECT ap.id, COALESCE(ap.organization, ap.name) INTO v_partner_id, v_partner_name
    FROM public.academic_partners ap WHERE ap.id = _partner_id AND ap.status = 'active';
  ELSE
    SELECT ap.id, COALESCE(ap.organization, ap.name) INTO v_partner_id, v_partner_name
    FROM public.academic_partners ap WHERE ap.user_id = v_uid AND ap.status = 'active';
  END IF;

  IF v_partner_id IS NULL THEN
    RAISE EXCEPTION 'Active academic partner not found';
  END IF;

  UPDATE public.lead_referrals
  SET status = _status,
      partner_notes = COALESCE(NULLIF(_notes, ''), partner_notes),
      outcome_at = CASE WHEN _status IN ('admitted', 'not_admitted') THEN now() ELSE outcome_at END,
      updated_at = now()
  WHERE id = _referral_id AND partner_id = v_partner_id
  RETURNING lead_id INTO v_lead_id;

  IF v_lead_id IS NULL THEN
    RAISE EXCEPTION 'Referral not found for this partner';
  END IF;

  SELECT name INTO v_lead_name FROM public.leads WHERE id = v_lead_id;
  SELECT id INTO v_actor_profile_id FROM public.profiles WHERE user_id = v_uid;

  INSERT INTO public.lead_activities (lead_id, type, description, user_id)
  VALUES (
    v_lead_id,
    'assignment',
    v_partner_name || ' marked the referral as ' || replace(_status, '_', ' ')
      || CASE WHEN COALESCE(_notes, '') <> '' THEN ': ' || _notes ELSE '' END,
    v_actor_profile_id
  );

  -- Terminal outcome: tell every super admin. Lead stage is deliberately untouched.
  IF _status IN ('admitted', 'not_admitted') THEN
    INSERT INTO public.notifications (user_id, type, title, body, link, lead_id)
    SELECT
      ur.user_id,
      'partner_referral_outcome',
      CASE WHEN _status = 'admitted'
           THEN 'Partner referral admitted'
           ELSE 'Partner referral not admitted' END,
      v_partner_name || ' marked ' || COALESCE(v_lead_name, 'a referred lead') || ' as '
        || replace(_status, '_', ' ')
        || CASE WHEN COALESCE(_notes, '') <> '' THEN ': ' || _notes ELSE '' END,
      format('/admissions/%s', v_lead_id),
      v_lead_id
    FROM public.user_roles ur
    WHERE ur.role = 'super_admin';
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.refer_lead_to_partner(uuid, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.academic_partner_update_referral(uuid, text, text, uuid) TO authenticated;
