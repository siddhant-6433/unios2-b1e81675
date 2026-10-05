-- Marketing list assignment, campaign recipient reporting, and campaign completion notifications.

ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check CHECK (type IN (
  'lead_assigned',
  'sla_warning',
  'lead_reclaimed',
  'followup_due',
  'followup_overdue',
  'visit_confirmation_due',
  'visit_followup_due',
  'lead_transferred',
  'deletion_request',
  'whatsapp_message',
  'whatsapp_sla_warning',
  'whatsapp_sla_breach',
  'approval_pending',
  'approval_decided',
  'template_status_update',
  'tat_defaults_report',
  'post_visit_nudge',
  'score_penalty',
  'lead_bucket_backlog',
  'feedback_received',
  'campaign_completed',
  'general',
  'visit_due',
  'missed_call',
  'callback_requested'
));

ALTER TABLE public.whatsapp_campaign_recipients
  DROP CONSTRAINT IF EXISTS whatsapp_campaign_recipients_status_check;

ALTER TABLE public.whatsapp_campaign_recipients
  ADD CONSTRAINT whatsapp_campaign_recipients_status_check
  CHECK (status IN ('pending', 'sent', 'delivered', 'read', 'failed', 'skipped', 'canceled'));

CREATE TABLE IF NOT EXISTS public.lead_list_assignment_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  list_id uuid NOT NULL REFERENCES public.lead_lists(id) ON DELETE CASCADE,
  assigned_by_profile_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  assigned_by_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  counsellor_ids uuid[] NOT NULL DEFAULT '{}',
  total_leads integer NOT NULL DEFAULT 0,
  assigned_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lead_list_assignment_batches_list_created
  ON public.lead_list_assignment_batches (list_id, created_at DESC);

ALTER TABLE public.lead_list_assignment_batches ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins can view lead list assignment batches" ON public.lead_list_assignment_batches;
CREATE POLICY "Admins can view lead list assignment batches"
  ON public.lead_list_assignment_batches
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin'::public.app_role)
    OR public.has_role(auth.uid(), 'admission_head'::public.app_role)
    OR public.has_role(auth.uid(), 'principal'::public.app_role)
    OR EXISTS (
      SELECT 1
      FROM public.profiles p
      JOIN public.teams t ON t.leader_id = p.id
      WHERE p.user_id = auth.uid()
    )
  );

GRANT SELECT ON public.lead_list_assignment_batches TO authenticated;
GRANT ALL ON public.lead_list_assignment_batches TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.whatsapp_template_settings TO service_role;

ALTER TABLE public.lead_assignment_history
  ADD COLUMN IF NOT EXISTS list_id uuid REFERENCES public.lead_lists(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS list_assignment_batch_id uuid REFERENCES public.lead_list_assignment_batches(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_lead_assignment_history_list_created
  ON public.lead_assignment_history (list_id, created_at DESC)
  WHERE list_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_lead_assignment_history_batch_created
  ON public.lead_assignment_history (list_assignment_batch_id, created_at DESC)
  WHERE list_assignment_batch_id IS NOT NULL;

ALTER TABLE public.lead_assignment_history
  DROP CONSTRAINT IF EXISTS lead_assignment_history_assignment_source_check;

ALTER TABLE public.lead_assignment_history
  ADD CONSTRAINT lead_assignment_history_assignment_source_check
  CHECK (assignment_source IN ('self_picked', 'assigned', 'ai_priority', 'list_round_robin'));

CREATE OR REPLACE FUNCTION public.assign_lead_list_round_robin(
  _list_id uuid,
  _counsellor_ids uuid[]
)
RETURNS TABLE (
  batch_id uuid,
  counsellor_id uuid,
  counsellor_name text,
  assigned_count integer,
  failed_count integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_user_id uuid := auth.uid();
  v_caller_profile_id uuid;
  v_is_admin boolean;
  v_is_team_leader boolean;
  v_list_exists boolean;
  v_batch_id uuid;
  v_total_leads integer := 0;
  v_assigned_count integer := 0;
  v_valid_counsellor_count integer := 0;
BEGIN
  IF v_caller_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF _list_id IS NULL THEN
    RAISE EXCEPTION 'List is required';
  END IF;

  IF COALESCE(array_length(_counsellor_ids, 1), 0) = 0 THEN
    RAISE EXCEPTION 'At least one counsellor is required';
  END IF;

  SELECT p.id INTO v_caller_profile_id
  FROM public.profiles p
  WHERE p.user_id = v_caller_user_id
  LIMIT 1;

  v_is_admin := public.has_role(v_caller_user_id, 'super_admin'::public.app_role)
                OR public.has_role(v_caller_user_id, 'admission_head'::public.app_role)
                OR public.has_role(v_caller_user_id, 'principal'::public.app_role);

  v_is_team_leader := EXISTS (
    SELECT 1
    FROM public.teams t
    WHERE t.leader_id = v_caller_profile_id
  );

  IF NOT (v_is_admin OR v_is_team_leader) THEN
    RAISE EXCEPTION 'Insufficient permissions to assign lead lists';
  END IF;

  SELECT EXISTS (SELECT 1 FROM public.lead_lists l WHERE l.id = _list_id)
  INTO v_list_exists;
  IF NOT v_list_exists THEN
    RAISE EXCEPTION 'Lead list not found';
  END IF;

  WITH requested AS (
    SELECT DISTINCT x.counsellor_id
    FROM unnest(_counsellor_ids) AS x(counsellor_id)
    WHERE x.counsellor_id IS NOT NULL
  ),
  valid AS (
    SELECT p.id
    FROM requested r
    JOIN public.profiles p ON p.id = r.counsellor_id
    JOIN public.user_roles ur ON ur.user_id = p.user_id
    WHERE ur.role = 'counsellor'::public.app_role
      AND COALESCE(p.login_disabled, false) = false
      AND (
        v_is_admin
        OR p.id = v_caller_profile_id
        OR EXISTS (
          SELECT 1
          FROM public.teams t
          JOIN public.team_members tm ON tm.team_id = t.id
          JOIN public.profiles member ON member.user_id = tm.user_id
          WHERE t.leader_id = v_caller_profile_id
            AND member.id = p.id
        )
      )
  )
  SELECT count(*) INTO v_valid_counsellor_count FROM valid;

  IF v_valid_counsellor_count <> (SELECT count(DISTINCT id) FROM unnest(_counsellor_ids) AS ids(id) WHERE id IS NOT NULL) THEN
    RAISE EXCEPTION 'One or more selected counsellors are outside your assignment scope';
  END IF;

  SELECT count(*) INTO v_total_leads
  FROM public.lead_list_members llm
  WHERE llm.list_id = _list_id;

  INSERT INTO public.lead_list_assignment_batches (
    list_id,
    assigned_by_profile_id,
    assigned_by_user_id,
    counsellor_ids,
    total_leads
  )
  VALUES (
    _list_id,
    v_caller_profile_id,
    v_caller_user_id,
    (SELECT array_agg(id ORDER BY ord)
     FROM (
       SELECT DISTINCT ON (p.id) p.id, requested.ord
       FROM unnest(_counsellor_ids) WITH ORDINALITY AS requested(id, ord)
       JOIN public.profiles p ON p.id = requested.id
       WHERE requested.id IS NOT NULL
       ORDER BY p.id, requested.ord
     ) ordered),
    v_total_leads
  )
  RETURNING id INTO v_batch_id;

  WITH selected_counsellors AS (
    SELECT p.id AS counsellor_id,
           p.display_name,
           row_number() OVER (ORDER BY requested.ord) AS counsellor_index
    FROM (
      SELECT DISTINCT ON (id) id, ord
      FROM unnest(_counsellor_ids) WITH ORDINALITY AS u(id, ord)
      WHERE id IS NOT NULL
      ORDER BY id, ord
    ) requested
    JOIN public.profiles p ON p.id = requested.id
  ),
  counsellor_count AS (
    SELECT count(*)::integer AS n FROM selected_counsellors
  ),
  ordered_members AS (
    SELECT
      llm.lead_id,
      row_number() OVER (ORDER BY llm.added_at, llm.lead_id) AS lead_index
    FROM public.lead_list_members llm
    WHERE llm.list_id = _list_id
  ),
  assignments AS (
    SELECT
      om.lead_id,
      sc.counsellor_id
    FROM ordered_members om
    CROSS JOIN counsellor_count cc
    JOIN selected_counsellors sc
      ON sc.counsellor_index = ((om.lead_index - 1) % cc.n) + 1
  ),
  current_rows AS (
    SELECT
      l.id AS lead_id,
      l.counsellor_id AS previous_counsellor_id,
      l.stage AS lead_stage_at_assignment,
      a.counsellor_id
    FROM assignments a
    JOIN public.leads l ON l.id = a.lead_id
  ),
  updated AS (
    UPDATE public.leads l
       SET counsellor_id = cr.counsellor_id
      FROM current_rows cr
     WHERE l.id = cr.lead_id
     RETURNING l.id
  ),
  history_insert AS (
    INSERT INTO public.lead_assignment_history (
      lead_id,
      assigned_to,
      previous_counsellor_id,
      assigned_by_profile_id,
      assigned_by_user_id,
      assignment_source,
      bucket_name,
      lead_stage_at_assignment,
      list_id,
      list_assignment_batch_id
    )
    SELECT
      cr.lead_id,
      cr.counsellor_id,
      cr.previous_counsellor_id,
      v_caller_profile_id,
      v_caller_user_id,
      'list_round_robin',
      'Lead List',
      cr.lead_stage_at_assignment,
      _list_id,
      v_batch_id
    FROM current_rows cr
    JOIN updated u ON u.id = cr.lead_id
    RETURNING assigned_to
  ),
  per_counsellor AS (
    SELECT assigned_to, count(*)::integer AS assigned_count
    FROM history_insert
    GROUP BY assigned_to
  )
  SELECT COALESCE(sum(pc.assigned_count), 0)::integer
    INTO v_assigned_count
  FROM per_counsellor pc;

  UPDATE public.lead_list_assignment_batches
     SET assigned_count = v_assigned_count,
         failed_count = GREATEST(v_total_leads - v_assigned_count, 0)
   WHERE id = v_batch_id;

  RETURN QUERY
  WITH selected_counsellors AS (
    SELECT p.id AS counsellor_id,
           COALESCE(p.display_name, 'Unknown')::text AS counsellor_name,
           row_number() OVER (ORDER BY requested.ord) AS counsellor_index
    FROM (
      SELECT DISTINCT ON (id) id, ord
      FROM unnest(_counsellor_ids) WITH ORDINALITY AS u(id, ord)
      WHERE id IS NOT NULL
      ORDER BY id, ord
    ) requested
    JOIN public.profiles p ON p.id = requested.id
  ),
  counts AS (
    SELECT h.assigned_to, count(*)::integer AS assigned_count
    FROM public.lead_assignment_history h
    WHERE h.list_assignment_batch_id = v_batch_id
    GROUP BY h.assigned_to
  )
  SELECT
    v_batch_id,
    sc.counsellor_id,
    sc.counsellor_name,
    COALESCE(c.assigned_count, 0)::integer,
    0::integer
  FROM selected_counsellors sc
  LEFT JOIN counts c ON c.assigned_to = sc.counsellor_id
  ORDER BY sc.counsellor_index;
END;
$$;

REVOKE ALL ON FUNCTION public.assign_lead_list_round_robin(uuid, uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assign_lead_list_round_robin(uuid, uuid[]) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_lead_list_assignment_report(
  _list_id uuid,
  _batch_id uuid DEFAULT NULL,
  _limit integer DEFAULT 500
)
RETURNS TABLE (
  assignment_id uuid,
  batch_id uuid,
  lead_id uuid,
  lead_name text,
  lead_phone text,
  lead_stage text,
  course_name text,
  campus_name text,
  assigned_to uuid,
  assigned_to_name text,
  assigned_by_name text,
  previous_counsellor_name text,
  latest_call_disposition text,
  latest_call_response text,
  latest_call_at timestamptz,
  assigned_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_user_id uuid := auth.uid();
  v_caller_profile_id uuid;
  v_is_admin boolean;
BEGIN
  IF v_caller_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT p.id INTO v_caller_profile_id
  FROM public.profiles p
  WHERE p.user_id = v_caller_user_id
  LIMIT 1;

  v_is_admin := public.has_role(v_caller_user_id, 'super_admin'::public.app_role)
                OR public.has_role(v_caller_user_id, 'admission_head'::public.app_role)
                OR public.has_role(v_caller_user_id, 'principal'::public.app_role);

  RETURN QUERY
  SELECT
    h.id AS assignment_id,
    h.list_assignment_batch_id AS batch_id,
    h.lead_id,
    l.name::text AS lead_name,
    l.phone::text AS lead_phone,
    l.stage::text AS lead_stage,
    c.name::text AS course_name,
    ca.name::text AS campus_name,
    h.assigned_to,
    COALESCE(assignee.display_name, 'Unknown')::text AS assigned_to_name,
    COALESCE(assigner.display_name, 'System')::text AS assigned_by_name,
    previous.display_name::text AS previous_counsellor_name,
    latest.disposition::text AS latest_call_disposition,
    latest.response::text AS latest_call_response,
    latest.called_at AS latest_call_at,
    h.created_at AS assigned_at
  FROM public.lead_assignment_history h
  JOIN public.leads l ON l.id = h.lead_id
  LEFT JOIN public.courses c ON c.id = l.course_id
  LEFT JOIN public.campuses ca ON ca.id = l.campus_id
  LEFT JOIN public.profiles assignee ON assignee.id = h.assigned_to
  LEFT JOIN public.profiles assigner ON assigner.id = h.assigned_by_profile_id
  LEFT JOIN public.profiles previous ON previous.id = h.previous_counsellor_id
  LEFT JOIN LATERAL (
    SELECT x.disposition, x.response, x.called_at
    FROM (
      SELECT cl.disposition, cl.notes AS response, cl.called_at
      FROM public.call_logs cl
      WHERE cl.lead_id = h.lead_id
      UNION ALL
      SELECT acl.disposition, acl.disposition_notes AS response, acl.created_at AS called_at
      FROM public.ai_call_logs acl
      WHERE acl.lead_id = h.lead_id
    ) x
    WHERE x.disposition IS NOT NULL OR x.response IS NOT NULL
    ORDER BY x.called_at DESC NULLS LAST
    LIMIT 1
  ) latest ON true
  WHERE h.list_id = _list_id
    AND (_batch_id IS NULL OR h.list_assignment_batch_id = _batch_id)
    AND (
      v_is_admin
      OR h.assigned_to = v_caller_profile_id
      OR EXISTS (
        SELECT 1
        FROM public.teams t
        JOIN public.team_members tm ON tm.team_id = t.id
        JOIN public.profiles member ON member.user_id = tm.user_id
        WHERE t.leader_id = v_caller_profile_id
          AND member.id = h.assigned_to
      )
    )
  ORDER BY h.created_at DESC
  LIMIT GREATEST(1, LEAST(COALESCE(_limit, 500), 1000));
END;
$$;

REVOKE ALL ON FUNCTION public.get_lead_list_assignment_report(uuid, uuid, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_lead_list_assignment_report(uuid, uuid, integer) TO authenticated;

-- Keep lead assignment notifications compatible with leads.counsellor_id storing profiles.id
-- while notifications.user_id references auth.users.id.
CREATE OR REPLACE FUNCTION public.fn_notify_lead_assigned()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_counsellor_user_id uuid;
BEGIN
  IF (OLD.counsellor_id IS DISTINCT FROM NEW.counsellor_id) AND NEW.counsellor_id IS NOT NULL THEN
    SELECT p.user_id INTO v_counsellor_user_id
    FROM public.profiles p
    WHERE p.id = NEW.counsellor_id
    LIMIT 1;

    IF v_counsellor_user_id IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, type, title, body, link, lead_id)
      VALUES (
        v_counsellor_user_id,
        'lead_assigned',
        'New lead assigned: ' || NEW.name,
        'Make first contact within the SLA window.',
        '/admissions/' || NEW.id,
        NEW.id
      );
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.notify_campaign_completed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_channel text;
  v_title text;
  v_body text;
  v_link text;
BEGIN
  IF NEW.status IS DISTINCT FROM 'completed'
     OR COALESCE(OLD.status, '') = 'completed' THEN
    RETURN NEW;
  END IF;

  v_channel := CASE
    WHEN TG_TABLE_NAME = 'whatsapp_campaigns' THEN 'WhatsApp'
    WHEN TG_TABLE_NAME = 'email_campaigns' THEN 'Email'
    ELSE 'Marketing'
  END;
  v_title := v_channel || ' campaign completed';
  v_body := NEW.name || ': '
            || COALESCE(NEW.sent_count, 0)::text || ' sent, '
            || COALESCE(NEW.failed_count, 0)::text || ' failed, '
            || COALESCE(NEW.total_recipients, 0)::text || ' total recipients.';
  v_link := '/marketing?campaign=' || NEW.id::text || '&channel=' || lower(v_channel);

  INSERT INTO public.notifications (user_id, type, title, body, link)
  SELECT DISTINCT recipients.user_id, 'campaign_completed', v_title, v_body, v_link
  FROM (
    SELECT ur.user_id
    FROM public.user_roles ur
    WHERE ur.role = 'super_admin'::public.app_role
    UNION
    SELECT p.user_id
    FROM public.profiles p
    WHERE p.id = NEW.created_by
      AND p.user_id IS NOT NULL
  ) recipients
  WHERE recipients.user_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1
      FROM public.notifications n
      WHERE n.user_id = recipients.user_id
        AND n.type = 'campaign_completed'
        AND n.link = v_link
    );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_whatsapp_campaign_completed ON public.whatsapp_campaigns;
CREATE TRIGGER trg_notify_whatsapp_campaign_completed
AFTER UPDATE OF status ON public.whatsapp_campaigns
FOR EACH ROW
WHEN (NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed')
EXECUTE FUNCTION public.notify_campaign_completed();

DROP TRIGGER IF EXISTS trg_notify_email_campaign_completed ON public.email_campaigns;
CREATE TRIGGER trg_notify_email_campaign_completed
AFTER UPDATE OF status ON public.email_campaigns
FOR EACH ROW
WHEN (NEW.status = 'completed' AND OLD.status IS DISTINCT FROM 'completed')
EXECUTE FUNCTION public.notify_campaign_completed();
