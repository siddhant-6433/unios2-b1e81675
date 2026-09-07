-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260901142530 name=course_fee_admission_report applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

CREATE OR REPLACE FUNCTION public.course_fee_admission_report(_course_id uuid)
RETURNS TABLE (
  name text, phone text, stage text, pre_admission_no text, admission_no text,
  abvmu_status text, abvmu_credit numeric,
  app_paid numeric, app_due numeric, uniform_paid numeric, uniform_due numeric,
  tuition_paid numeric, tuition_due numeric,
  total_billed numeric, total_paid numeric, total_due numeric
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT (
       public.has_role(auth.uid(), 'super_admin'::app_role)
       OR public.has_role(auth.uid(), 'accountant'::app_role)
       OR public.has_role(auth.uid(), 'campus_admin'::app_role)
       OR public.has_role(auth.uid(), 'principal'::app_role)
       OR public.has_role(auth.uid(), 'admission_head'::app_role)
     ) THEN
    RAISE EXCEPTION 'Not authorized to view the course fee report';
  END IF;

  RETURN QUERY
  SELECT
    COALESCE(l.name, st.name) AS name,
    COALESCE(l.phone, st.phone) AS phone,
    COALESCE(l.stage, st.status) AS stage,
    st.pre_admission_no, st.admission_no,
    (SELECT string_agg(DISTINCT ac.status, ',') FROM public.abvmu_deposit_claims ac WHERE ac.lead_id = st.lead_id) AS abvmu_status,
    COALESCE((SELECT sum(ac.amount) FROM public.abvmu_deposit_claims ac WHERE ac.lead_id = st.lead_id AND ac.status = 'approved'), 0) AS abvmu_credit,
    COALESCE(sum(fl.paid_amount) FILTER (WHERE fc.code = 'FORM-FEE'), 0) AS app_paid,
    COALESCE(sum(fl.balance) FILTER (WHERE fc.code = 'FORM-FEE'), 0) AS app_due,
    COALESCE(sum(fl.paid_amount) FILTER (WHERE fc.code = 'UNIFORM'), 0) AS uniform_paid,
    COALESCE(sum(fl.balance) FILTER (WHERE fc.code = 'UNIFORM'), 0) AS uniform_due,
    COALESCE(sum(fl.paid_amount) FILTER (WHERE fc.code ILIKE 'TUITION%'), 0) AS tuition_paid,
    COALESCE(sum(fl.balance) FILTER (WHERE fc.code ILIKE 'TUITION%'), 0) AS tuition_due,
    COALESCE(sum(fl.total_amount - fl.concession), 0) AS total_billed,
    COALESCE(sum(fl.paid_amount), 0) AS total_paid,
    COALESCE(sum(fl.balance), 0) AS total_due
  FROM public.students st
  LEFT JOIN public.leads l ON l.id = st.lead_id
  LEFT JOIN public.fee_ledger fl ON fl.student_id = st.id
  LEFT JOIN public.fee_codes fc ON fc.id = fl.fee_code_id
  WHERE st.course_id = _course_id
  GROUP BY st.id, l.name, st.name, l.phone, st.phone, l.stage, st.status, st.pre_admission_no, st.admission_no, st.lead_id
  ORDER BY COALESCE(l.name, st.name);
END;
$$;
GRANT EXECUTE ON FUNCTION public.course_fee_admission_report(uuid) TO authenticated, service_role;
