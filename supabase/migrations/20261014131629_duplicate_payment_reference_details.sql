-- Return only the identifying details needed to reconcile a confirmed payment
-- that already owns an offline UPI / bank reference. The function uses the
-- same finance roles as the offline receipt dialog and never returns contact
-- details or payment notes.

CREATE OR REPLACE FUNCTION public.lookup_confirmed_payment_reference(_reference text)
RETURNS TABLE (
  receipt_no text,
  candidate_name text,
  admission_no text,
  course_name text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reference text := NULLIF(BTRIM(_reference), '');
BEGIN
  IF auth.uid() IS NULL OR NOT (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'accountant') OR
    public.has_role(auth.uid(), 'office_admin')
  ) THEN
    RAISE EXCEPTION 'Not authorised';
  END IF;

  IF v_reference IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT lp.receipt_no,
         COALESCE(NULLIF(BTRIM(s.name), ''), NULLIF(BTRIM(l.name), ''), NULLIF(BTRIM(a.full_name), '')),
         COALESCE(NULLIF(BTRIM(s.admission_no), ''), NULLIF(BTRIM(l.admission_no), ''),
                  NULLIF(BTRIM(s.pre_admission_no), ''), NULLIF(BTRIM(l.pre_admission_no), '')),
         COALESCE(app_course.course_name, course.name)
    FROM public.lead_payments lp
    LEFT JOIN public.leads l ON l.id = lp.lead_id
    LEFT JOIN LATERAL (
      SELECT st.*
        FROM public.students st
       WHERE st.id = lp.student_id
          OR (lp.student_id IS NULL AND st.lead_id = lp.lead_id)
       ORDER BY (st.id = lp.student_id) DESC, st.created_at DESC
       LIMIT 1
    ) s ON true
    LEFT JOIN public.courses course ON course.id = s.course_id
    LEFT JOIN LATERAL (
      SELECT ap.*
        FROM public.applications ap
       WHERE (NULLIF(BTRIM(lp.application_id), '') IS NOT NULL
              AND ap.application_id = NULLIF(BTRIM(lp.application_id), ''))
          OR (NULLIF(BTRIM(lp.application_id), '') IS NULL
              AND ap.lead_id = lp.lead_id)
       ORDER BY (ap.application_id = NULLIF(BTRIM(lp.application_id), '')) DESC NULLS LAST,
                ap.updated_at DESC
       LIMIT 1
    ) a ON true
    LEFT JOIN LATERAL (
      SELECT COALESCE(NULLIF(BTRIM(selection.item->>'course_name'), ''), selected_course.name) AS course_name
        FROM jsonb_array_elements(
               CASE WHEN jsonb_typeof(a.course_selections) = 'array'
                    THEN a.course_selections ELSE '[]'::jsonb END
             ) WITH ORDINALITY AS selection(item, ordinal)
        LEFT JOIN public.courses selected_course
          ON selected_course.id = CASE
            WHEN NULLIF(selection.item->>'course_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            THEN (selection.item->>'course_id')::uuid
          END
       WHERE NULLIF(BTRIM(selection.item->>'course_name'), '') IS NOT NULL
          OR selected_course.name IS NOT NULL
       ORDER BY selection.ordinal
       LIMIT 1
    ) app_course ON true
   WHERE lp.status = 'confirmed'
     AND (lp.transaction_ref = v_reference OR lp.bank_ref_num = v_reference)
   ORDER BY lp.created_at DESC
   LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION public.lookup_confirmed_payment_reference(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lookup_confirmed_payment_reference(text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

