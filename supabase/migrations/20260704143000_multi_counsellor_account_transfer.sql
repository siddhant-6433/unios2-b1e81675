-- Account transfer v2: distribute a counsellor's leads across multiple staff.
-- Supports default round-robin assignment and optional course-specific pools.

CREATE OR REPLACE FUNCTION public.transfer_counsellor_account_multi(
  source_profile_id uuid,
  target_profile_ids uuid[],
  disable_source boolean DEFAULT true,
  course_target_map jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_targets uuid[];
  v_leads integer := 0;
  v_wa_linked integer := 0;
  v_wa_remaining integer := 0;
  v_by_target jsonb := '[]'::jsonb;
  v_by_course jsonb := '[]'::jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'super_admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only super admins can transfer accounts';
  END IF;

  SELECT array_agg(profile_id ORDER BY first_ord)
  INTO v_targets
  FROM (
    SELECT profile_id, min(ord) AS first_ord
    FROM unnest(COALESCE(target_profile_ids, ARRAY[]::uuid[])) WITH ORDINALITY AS t(profile_id, ord)
    WHERE profile_id IS NOT NULL
    GROUP BY profile_id
  ) deduped;

  IF COALESCE(array_length(v_targets, 1), 0) = 0 THEN
    RAISE EXCEPTION 'At least one target staff member is required';
  END IF;

  IF source_profile_id = ANY(v_targets) THEN
    RAISE EXCEPTION 'Source cannot be one of the transfer targets';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM unnest(v_targets) target_id
    LEFT JOIN public.profiles p ON p.id = target_id
    WHERE p.id IS NULL
  ) THEN
    RAISE EXCEPTION 'One or more target staff members do not exist';
  END IF;

  IF course_target_map IS NULL THEN
    course_target_map := '[]'::jsonb;
  END IF;

  IF jsonb_typeof(course_target_map) <> 'array' THEN
    RAISE EXCEPTION 'course_target_map must be a JSON array';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(course_target_map) rule
    WHERE (rule->>'course_id') IS NULL
      OR jsonb_typeof(rule->'target_profile_ids') IS DISTINCT FROM 'array'
      OR jsonb_array_length(rule->'target_profile_ids') = 0
  ) THEN
    RAISE EXCEPTION 'Each course rule requires course_id and at least one target_profile_id';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM (
      SELECT (rule->>'course_id')::uuid AS course_id, count(*) AS rule_count
      FROM jsonb_array_elements(course_target_map) rule
      GROUP BY (rule->>'course_id')::uuid
    ) duplicate_rules
    WHERE duplicate_rules.rule_count > 1
  ) THEN
    RAISE EXCEPTION 'Each course can only have one transfer rule';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(course_target_map) rule
    LEFT JOIN public.courses c ON c.id = (rule->>'course_id')::uuid
    WHERE c.id IS NULL
  ) THEN
    RAISE EXCEPTION 'One or more course rules reference an unknown course';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM jsonb_array_elements(course_target_map) rule
    CROSS JOIN LATERAL jsonb_array_elements_text(rule->'target_profile_ids') AS target(target_id)
    WHERE NOT ((target.target_id)::uuid = ANY(v_targets))
  ) THEN
    RAISE EXCEPTION 'Course rules can only use selected transfer targets';
  END IF;

  DROP TABLE IF EXISTS pg_temp.transfer_counsellor_assignments;
  CREATE TEMP TABLE transfer_counsellor_assignments ON COMMIT DROP AS
  WITH course_rules AS (
    SELECT
      (rule->>'course_id')::uuid AS course_id,
      ARRAY(
        SELECT target_id
        FROM (
          SELECT target.target_id::uuid AS target_id, min(target.ord) AS first_ord
          FROM jsonb_array_elements_text(rule->'target_profile_ids') WITH ORDINALITY AS target(target_id, ord)
          GROUP BY target.target_id::uuid
        ) deduped_targets
        ORDER BY first_ord
      ) AS target_ids
    FROM jsonb_array_elements(course_target_map) rule
  ),
  source_leads AS (
    SELECT
      l.id AS lead_id,
      l.course_id,
      l.created_at,
      COALESCE(cr.target_ids, v_targets) AS target_ids,
      CASE WHEN cr.course_id IS NULL THEN '__default__' ELSE l.course_id::text END AS assignment_group
    FROM public.leads l
    LEFT JOIN course_rules cr ON cr.course_id = l.course_id
    WHERE l.counsellor_id = source_profile_id
  ),
  numbered AS (
    SELECT
      lead_id,
      course_id,
      target_ids,
      row_number() OVER (PARTITION BY assignment_group ORDER BY created_at, lead_id) AS rn
    FROM source_leads
  )
  SELECT
    lead_id,
    course_id,
    target_ids[((rn - 1) % array_length(target_ids, 1)) + 1] AS target_profile_id
  FROM numbered;

  UPDATE public.leads l
  SET counsellor_id = a.target_profile_id
  FROM pg_temp.transfer_counsellor_assignments a
  WHERE l.id = a.lead_id;
  GET DIAGNOSTICS v_leads = ROW_COUNT;

  UPDATE public.whatsapp_messages wm
  SET assigned_to = a.target_profile_id
  FROM pg_temp.transfer_counsellor_assignments a
  WHERE wm.lead_id = a.lead_id
    AND wm.assigned_to = source_profile_id;
  GET DIAGNOSTICS v_wa_linked = ROW_COUNT;

  DROP TABLE IF EXISTS pg_temp.transfer_counsellor_wa_assignments;
  CREATE TEMP TABLE transfer_counsellor_wa_assignments ON COMMIT DROP AS
  WITH remaining AS (
    SELECT
      wm.id AS message_id,
      row_number() OVER (ORDER BY wm.created_at, wm.id) AS rn
    FROM public.whatsapp_messages wm
    WHERE wm.assigned_to = source_profile_id
  )
  SELECT
    message_id,
    v_targets[((rn - 1) % array_length(v_targets, 1)) + 1] AS target_profile_id
  FROM remaining;

  UPDATE public.whatsapp_messages wm
  SET assigned_to = a.target_profile_id
  FROM pg_temp.transfer_counsellor_wa_assignments a
  WHERE wm.id = a.message_id;
  GET DIAGNOSTICS v_wa_remaining = ROW_COUNT;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'target_profile_id', target_profile_id,
      'leads_transferred', leads_transferred
    )
    ORDER BY target_profile_id
  ), '[]'::jsonb)
  INTO v_by_target
  FROM (
    SELECT target_profile_id, count(*)::integer AS leads_transferred
    FROM pg_temp.transfer_counsellor_assignments
    GROUP BY target_profile_id
  ) counts;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'course_id', course_id,
      'target_profile_id', target_profile_id,
      'leads_transferred', leads_transferred
    )
    ORDER BY course_id NULLS LAST, target_profile_id
  ), '[]'::jsonb)
  INTO v_by_course
  FROM (
    SELECT course_id, target_profile_id, count(*)::integer AS leads_transferred
    FROM pg_temp.transfer_counsellor_assignments
    GROUP BY course_id, target_profile_id
  ) counts;

  IF disable_source THEN
    UPDATE public.profiles
    SET login_disabled = true
    WHERE id = source_profile_id;
  END IF;

  RETURN jsonb_build_object(
    'leads_transferred', v_leads,
    'whatsapp_messages_transferred', v_wa_linked + v_wa_remaining,
    'whatsapp_messages_linked_transferred', v_wa_linked,
    'whatsapp_messages_remaining_transferred', v_wa_remaining,
    'by_target', v_by_target,
    'by_course', v_by_course
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.transfer_counsellor_account_multi(uuid, uuid[], boolean, jsonb) TO authenticated;
