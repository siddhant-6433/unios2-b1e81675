-- Temporary operational toggle for overdue follow-up enforcement.
--
-- Counsellors are currently unable to clear overdue call follow-ups, so
-- super_admin can suppress overdue follow-up queues/counts and the direct-dial
-- guard without deleting the follow-up feature or its data.

INSERT INTO public._app_config (key, value)
VALUES ('overdue_followup_enforcement_enabled', 'true')
ON CONFLICT (key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.get_overdue_followup_enforcement_enabled()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((
    SELECT value::boolean
    FROM public._app_config
    WHERE key = 'overdue_followup_enforcement_enabled'
  ), true);
$$;

CREATE OR REPLACE FUNCTION public.set_overdue_followup_enforcement_enabled(_enabled boolean)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'super_admin') THEN
    RAISE EXCEPTION 'Only super_admin can change overdue follow-up enforcement';
  END IF;

  INSERT INTO public._app_config (key, value)
  VALUES ('overdue_followup_enforcement_enabled', COALESCE(_enabled, true)::text)
  ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;

  RETURN COALESCE(_enabled, true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_overdue_followup_enforcement_enabled() TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_overdue_followup_enforcement_enabled(boolean) TO authenticated;

CREATE OR REPLACE VIEW public.overdue_followups AS
SELECT
  lf.id,
  lf.lead_id,
  lf.user_id AS counsellor_user_id,
  lf.scheduled_at,
  lf.type,
  lf.notes,
  l.name AS lead_name,
  l.phone AS lead_phone,
  l.stage AS lead_stage,
  l.counsellor_id,
  EXTRACT(DAY FROM now() - lf.scheduled_at)::integer AS days_overdue
FROM public.lead_followups lf
JOIN public.leads l ON l.id = lf.lead_id
WHERE public.get_overdue_followup_enforcement_enabled()
  AND lf.status = 'pending'
  AND lf.scheduled_at < now()
  AND l.stage NOT IN ('not_interested', 'dnc', 'rejected', 'ineligible', 'admitted', 'cold')
ORDER BY lf.scheduled_at ASC;

ALTER VIEW public.overdue_followups SET (security_invoker = true);
GRANT SELECT ON public.overdue_followups TO authenticated;

DO $$
BEGIN
  IF to_regprocedure('public.action_badge_counts_base(uuid, boolean)') IS NULL
     AND to_regprocedure('public.action_badge_counts(uuid, boolean)') IS NOT NULL THEN
    ALTER FUNCTION public.action_badge_counts(uuid, boolean)
    RENAME TO action_badge_counts_base;
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.action_badge_counts(
  p_scope_counsellor_id uuid DEFAULT NULL,
  p_include_unassigned boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_payload jsonb;
  v_overdue integer;
  v_tat_defaults integer;
BEGIN
  v_payload := public.action_badge_counts_base(p_scope_counsellor_id, p_include_unassigned);

  IF public.get_overdue_followup_enforcement_enabled() THEN
    RETURN v_payload;
  END IF;

  v_overdue := COALESCE((v_payload->>'overdue')::integer, 0);
  v_tat_defaults := GREATEST(COALESCE((v_payload->>'tat_defaults')::integer, 0) - v_overdue, 0);

  RETURN jsonb_set(
    jsonb_set(COALESCE(v_payload, '{}'::jsonb), '{overdue}', '0'::jsonb, true),
    '{tat_defaults}',
    to_jsonb(v_tat_defaults),
    true
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.action_badge_counts(uuid, boolean) TO authenticated;

DO $$
BEGIN
  IF to_regprocedure('public.pending_followups_payload_base(text, uuid, boolean, integer, integer)') IS NULL
     AND to_regprocedure('public.pending_followups_payload(text, uuid, boolean, integer, integer)') IS NOT NULL THEN
    ALTER FUNCTION public.pending_followups_payload(text, uuid, boolean, integer, integer)
    RENAME TO pending_followups_payload_base;
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION public.pending_followups_payload(
  p_tab text,
  p_scope_counsellor_id uuid DEFAULT NULL,
  p_scope_unassigned boolean DEFAULT false,
  p_page integer DEFAULT 0,
  p_page_size integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_payload jsonb;
BEGIN
  v_payload := public.pending_followups_payload_base(
    p_tab,
    p_scope_counsellor_id,
    p_scope_unassigned,
    p_page,
    p_page_size
  );

  IF public.get_overdue_followup_enforcement_enabled() THEN
    RETURN v_payload;
  END IF;

  v_payload := jsonb_set(COALESCE(v_payload, '{}'::jsonb), '{counts,overdue}', '0'::jsonb, true);

  IF p_tab = 'overdue' THEN
    v_payload := jsonb_set(v_payload, '{items}', '[]'::jsonb, true);
  END IF;

  RETURN v_payload;
END;
$$;

GRANT EXECUTE ON FUNCTION public.pending_followups_payload(text, uuid, boolean, integer, integer) TO authenticated;

ALTER FUNCTION IF EXISTS public.action_center_payload(uuid)
RENAME TO action_center_payload_base;

CREATE OR REPLACE FUNCTION public.action_center_payload(
  p_counsellor_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_payload jsonb;
BEGIN
  v_payload := public.action_center_payload_base(p_counsellor_id);

  IF public.get_overdue_followup_enforcement_enabled() THEN
    RETURN v_payload;
  END IF;

  RETURN jsonb_set(COALESCE(v_payload, '{}'::jsonb), '{overdueFollowups}', '[]'::jsonb, true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.action_center_payload(uuid) TO authenticated;

ALTER FUNCTION IF EXISTS public.my_tat_defaults(uuid)
RENAME TO my_tat_defaults_base;

CREATE OR REPLACE FUNCTION public.my_tat_defaults(
  p_scope_counsellor_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_payload jsonb;
  v_overdue integer;
  v_total integer;
BEGIN
  v_payload := public.my_tat_defaults_base(p_scope_counsellor_id);

  IF public.get_overdue_followup_enforcement_enabled() THEN
    RETURN v_payload;
  END IF;

  v_overdue := COALESCE((v_payload->>'overdue_followups')::integer, 0);
  v_total := GREATEST(COALESCE((v_payload->>'total_defaults')::integer, 0) - v_overdue, 0);

  RETURN jsonb_set(
    jsonb_set(COALESCE(v_payload, '{}'::jsonb), '{overdue_followups}', '0'::jsonb, true),
    '{total_defaults}',
    to_jsonb(v_total),
    true
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.my_tat_defaults(uuid) TO authenticated;

ALTER FUNCTION IF EXISTS public.counsellor_calling_summary(date, date)
RENAME TO counsellor_calling_summary_base;

CREATE OR REPLACE FUNCTION public.counsellor_calling_summary(
  p_from_date date DEFAULT NULL,
  p_to_date date DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_payload jsonb;
BEGIN
  v_payload := public.counsellor_calling_summary_base(p_from_date, p_to_date);

  IF public.get_overdue_followup_enforcement_enabled() THEN
    RETURN v_payload;
  END IF;

  SELECT COALESCE(
    jsonb_agg(jsonb_set(row_payload.value, '{overdueFollowups}', '0'::jsonb, true)),
    '[]'::jsonb
  )
  INTO v_payload
  FROM jsonb_array_elements(COALESCE(v_payload, '[]'::jsonb)) AS row_payload(value);

  RETURN v_payload;
END;
$$;

GRANT EXECUTE ON FUNCTION public.counsellor_calling_summary(date, date) TO authenticated;

NOTIFY pgrst, 'reload schema';
