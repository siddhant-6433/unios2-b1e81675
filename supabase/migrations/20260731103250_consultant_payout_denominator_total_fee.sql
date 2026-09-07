-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260731103250 name=consultant_payout_denominator_total_fee applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

CREATE OR REPLACE FUNCTION public.consultant_lead_fee_base(_lead_id uuid)
RETURNS TABLE(net_collected numeric, net_first_year numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_student uuid; v_status jsonb;
BEGIN
  v_status := public.lead_fee_status(_lead_id);

  net_first_year := COALESCE(
    NULLIF((v_status ->> 'post_scholarship_year_1')::numeric, 0),
    NULLIF((v_status ->> 'total_course_fee')::numeric, 0),
    NULLIF((v_status ->> 'first_year_fee')::numeric, 0),
    0);

  SELECT id INTO v_student FROM public.students WHERE lead_id = _lead_id LIMIT 1;
  IF v_student IS NOT NULL THEN
    SELECT COALESCE(SUM(fl.paid_amount), 0) INTO net_collected
    FROM public.fee_ledger fl
    JOIN public.fee_codes fc ON fc.id = fl.fee_code_id
    WHERE fl.student_id = v_student
      AND fc.category NOT IN ('enrollment', 'late_fee')
      AND COALESCE(fl.term, '') !~ '^year_[2-9]';
  ELSE
    net_collected := COALESCE((v_status ->> 'paid_toward_course')::numeric, 0);
  END IF;

  RETURN NEXT;
END $$;

DROP VIEW IF EXISTS public.consultant_payout_sheet;
CREATE VIEW public.consultant_payout_sheet AS
SELECT
  cp.id            AS payout_id,
  cp.consultant_id,
  c.name           AS consultant_name,
  c.bank_account_name,
  c.bank_account_number,
  c.bank_ifsc,
  c.bank_name,
  c.bank_upi,
  cp.lead_id,
  l.name           AS candidate_name,
  COALESCE(l.admission_no, l.pre_admission_no) AS admission_no,
  crs.name         AS course_name,
  cp.student_fee_paid,
  cp.annual_fee,
  cp.payout_amount,
  cp.fee_paid_pct,
  cp.status,
  cp.created_at
FROM public.consultant_payouts cp
JOIN public.consultants c ON c.id = cp.consultant_id
JOIN public.leads       l ON l.id = cp.lead_id
LEFT JOIN public.courses crs ON crs.id = cp.course_id;

GRANT SELECT ON public.consultant_payout_sheet TO authenticated;

DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT id FROM public.leads WHERE consultant_id IS NOT NULL LOOP
    PERFORM public.recompute_consultant_payout(r.id);
  END LOOP;
END $$;
