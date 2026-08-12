-- "Pending AN Generation": inbox list RPC + sidebar-badge inclusion.
--
-- A student is pending-AN when they are pre-admitted (PAN), not yet admitted,
-- have crossed the 25% fee threshold, but are held by the mandatory-document gate.
-- The population "PAN and no AN" is small (~90); lead_fee_status runs only on the
-- doc-blocked subset (~tens), so this is cheap enough for the badge.

-- ── Inbox list (super_admin + principal) ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.list_pending_an_generation()
 RETURNS TABLE (
   lead_id uuid, student_id uuid, name text, course text,
   pre_admission_no text, application_id text, admission_doc_status jsonb
 )
 LANGUAGE plpgsql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT (public.has_role(auth.uid(), 'super_admin'::public.app_role)
          OR public.has_role(auth.uid(), 'principal'::public.app_role)) THEN
    RETURN;  -- other roles get an empty set
  END IF;

  RETURN QUERY
  SELECT l.id, s.id, s.name, c.name, s.pre_admission_no, a.application_id, a.admission_doc_status
    FROM public.students s
    JOIN public.leads l ON l.id = s.lead_id
    LEFT JOIN public.courses c ON c.id = s.course_id
    LEFT JOIN LATERAL (
      SELECT ap.application_id, ap.admission_doc_status
        FROM public.applications ap
       WHERE ap.lead_id = l.id
       ORDER BY ap.created_at DESC NULLS LAST
       LIMIT 1
    ) a ON true
   WHERE s.pre_admission_no IS NOT NULL
     AND s.admission_no IS NULL
     AND NOT public.lead_docs_ready_for_admission(l.id)
     AND (public.lead_fee_status(l.id)->>'twenty_five_complete')::boolean
   ORDER BY s.name;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.list_pending_an_generation() TO authenticated;

-- ── Add the pending-AN branch to the approvals badge view ────────────────────
-- (count_pending_approvals() counts this view; pending_role='principal' so
--  super_admin + principal both include it in the sidebar "Inbox" badge.)
CREATE OR REPLACE VIEW public.pending_approvals AS
 SELECT 'concession'::text AS kind, (c.id)::text AS id, c.status,
    (c.student_id)::text AS subject_id, s.name AS subject_name,
    c.type AS detail_type, c.value AS detail_value, c.reason,
    (c.requested_by)::text AS requested_by_id, c.created_at,
    CASE WHEN (c.status = 'pending_principal'::text) THEN 'principal'::text
         WHEN (c.status = 'pending_super_admin'::text) THEN 'super_admin'::text
         ELSE NULL::text END AS pending_role
   FROM (concessions c LEFT JOIN students s ON ((s.id = c.student_id)))
  WHERE (c.status = ANY (ARRAY['pending_principal'::text, 'pending_super_admin'::text]))
UNION ALL
 SELECT 'offer_letter'::text, (ol.id)::text, ol.approval_status, (ol.lead_id)::text, l.name,
    'flat'::text, ol.net_fee, NULL::text, (ol.issued_by)::text, ol.created_at, 'principal'::text
   FROM (offer_letters ol LEFT JOIN leads l ON ((l.id = ol.lead_id)))
  WHERE (ol.approval_status = 'pending_principal'::text)
UNION ALL
 SELECT 'offer_edit'::text, (er.id)::text, er.status, (ol.lead_id)::text, l.name,
    'edit_request'::text, NULL::numeric, er.reason, (er.requested_by)::text, er.created_at, 'super_admin'::text
   FROM ((offer_letter_edit_requests er
     JOIN offer_letters ol ON ((ol.id = er.offer_letter_id)))
     LEFT JOIN leads l ON ((l.id = ol.lead_id)))
  WHERE (er.status = 'pending'::text)
UNION ALL
 SELECT 'student_contact_change'::text, (scr.id)::text, scr.status, (scr.student_id)::text, s.name,
    scr.field_name, NULL::numeric, scr.reason, (scr.requested_by)::text, scr.created_at, 'principal'::text
   FROM (student_contact_change_requests scr LEFT JOIN students s ON ((s.id = scr.student_id)))
  WHERE (scr.status = 'pending'::text)
UNION ALL
 SELECT 'lead_deletion'::text, (ldr.id)::text, 'pending_admin'::text, (ldr.lead_id)::text, l.name,
    ldr.reason, NULL::numeric, ldr.custom_message, (ldr.requested_by)::text, ldr.created_at, 'super_admin'::text
   FROM (lead_deletion_requests ldr LEFT JOIN leads l ON ((l.id = ldr.lead_id)))
  WHERE (ldr.status = 'pending'::text)
UNION ALL
 SELECT 'pending_an'::text, (l.id)::text, 'pending'::text, (s.id)::text, s.name,
    'pending_an'::text, NULL::numeric, NULL::text, NULL::text, s.updated_at, 'principal'::text
   FROM (students s JOIN leads l ON ((l.id = s.lead_id)))
  WHERE s.pre_admission_no IS NOT NULL
    AND s.admission_no IS NULL
    AND NOT public.lead_docs_ready_for_admission(l.id)
    AND (public.lead_fee_status(l.id)->>'twenty_five_complete')::boolean;
