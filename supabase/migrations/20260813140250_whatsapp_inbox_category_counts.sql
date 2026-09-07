-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260813140250 name=whatsapp_inbox_category_counts applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

CREATE OR REPLACE FUNCTION public.whatsapp_inbox_category_counts(
  p_counsellor_id uuid DEFAULT NULL,
  p_business_key  text DEFAULT NULL
)
RETURNS TABLE (
  category        text,
  conversations   integer,
  unread_messages integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  WITH last_msg AS (
    SELECT DISTINCT ON (wm.phone, public.whatsapp_conversation_key(wm.provider, wm.business_phone_number_id, wm.business_phone_number))
      wm.phone,
      public.whatsapp_conversation_key(wm.provider, wm.business_phone_number_id, wm.business_phone_number) AS ckey,
      wm.direction,
      wm.lead_id
    FROM public.whatsapp_messages wm
    WHERE p_business_key IS NULL
       OR (p_business_key = 'unattributed' AND wm.business_phone_number_id IS NULL)
       OR (p_business_key <> 'unattributed' AND (
             wm.business_phone_number_id = p_business_key
          OR wm.business_phone_number = p_business_key))
    ORDER BY wm.phone,
      public.whatsapp_conversation_key(wm.provider, wm.business_phone_number_id, wm.business_phone_number),
      wm.created_at DESC
  ),
  scoped AS (
    SELECT
      m.phone,
      m.ckey,
      m.lead_id,
      l.person_role AS person_role,
      EXISTS (
        SELECT 1
        FROM public.profiles pr
        JOIN public.user_roles ur ON ur.user_id = pr.user_id
        WHERE ur.role IN (
          'super_admin','campus_admin','principal','admission_head','counsellor',
          'accountant','faculty','teacher','data_entry','office_admin',
          'office_assistant','school_coordinator','hostel_warden'
        )
          AND pr.phone IS NOT NULL
          AND regexp_replace(pr.phone, '\D', '', 'g') = m.phone
      ) AS is_staff
    FROM last_msg m
    LEFT JOIN public.leads l ON l.id = m.lead_id
    WHERE
      EXISTS (
        SELECT 1 FROM public.whatsapp_messages i
        WHERE i.phone = m.phone
          AND i.direction = 'inbound'
          AND public.whatsapp_conversation_key(i.provider, i.business_phone_number_id, i.business_phone_number) = m.ckey
      )
      AND (p_counsellor_id IS NULL OR EXISTS (
        SELECT 1 FROM public.whatsapp_messages c
        JOIN public.leads cl ON cl.id = c.lead_id
        WHERE c.phone = m.phone
          AND public.whatsapp_conversation_key(c.provider, c.business_phone_number_id, c.business_phone_number) = m.ckey
          AND cl.counsellor_id = p_counsellor_id
      ))
  ),
  cats AS (
    SELECT
      s.phone,
      s.ckey,
      CASE
        WHEN s.person_role = 'job_applicant' THEN 'jobs'
        WHEN s.person_role IN ('vendor','other') THEN 'other'
        WHEN s.lead_id IS NOT NULL THEN 'admission'
        WHEN s.is_staff THEN 'staff'
        ELSE NULL
      END AS category,
      u.cnt AS unread_cnt
    FROM scoped s
    CROSS JOIN LATERAL (
      SELECT COUNT(*) AS cnt
      FROM public.whatsapp_messages wm2
      WHERE wm2.phone = s.phone
        AND wm2.direction = 'inbound'
        AND wm2.is_read = false
        AND public.whatsapp_conversation_key(wm2.provider, wm2.business_phone_number_id, wm2.business_phone_number) = s.ckey
        AND NOT EXISTS (
          SELECT 1 FROM public.whatsapp_messages r
          WHERE r.phone = wm2.phone
            AND r.direction = 'outbound'
            AND r.created_at > wm2.created_at
            AND public.whatsapp_conversation_key(r.provider, r.business_phone_number_id, r.business_phone_number) = s.ckey
        )
    ) u
  )
  SELECT 'all'::text AS category,
         COUNT(*)::integer AS conversations,
         COALESCE(SUM(unread_cnt), 0)::integer AS unread_messages
  FROM cats
  UNION ALL
  SELECT category,
         COUNT(*)::integer,
         COALESCE(SUM(unread_cnt), 0)::integer
  FROM cats
  WHERE category IS NOT NULL
  GROUP BY category;
$fn$;

COMMENT ON FUNCTION public.whatsapp_inbox_category_counts(uuid, text) IS
  'Population-accurate WhatsApp inbox counts per category (all/admission/staff/other/jobs), each with conversations + unread_messages. Same population and scoping as whatsapp_reply_state_counts; replaces the client-side page-bound chip aggregates.';

REVOKE ALL ON FUNCTION public.whatsapp_inbox_category_counts(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.whatsapp_inbox_category_counts(uuid, text) TO authenticated;
