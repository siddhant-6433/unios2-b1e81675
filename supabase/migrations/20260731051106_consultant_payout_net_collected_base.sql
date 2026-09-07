-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260731051106 name=consultant_payout_net_collected_base applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

CREATE OR REPLACE FUNCTION public.consultant_lead_fee_base(_lead_id uuid)
RETURNS TABLE(net_collected numeric, net_first_year numeric)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_student uuid; v_fs uuid;
BEGIN
  SELECT id INTO v_student FROM public.students WHERE lead_id = _lead_id LIMIT 1;

  IF v_student IS NOT NULL THEN
    SELECT
      COALESCE(SUM(fl.paid_amount), 0),
      COALESCE(SUM(GREATEST(fl.total_amount - COALESCE(fl.concession, 0), 0)), 0)
    INTO net_collected, net_first_year
    FROM public.fee_ledger fl
    JOIN public.fee_codes fc ON fc.id = fl.fee_code_id
    WHERE fl.student_id = v_student
      AND fc.category <> 'enrollment'
      AND fc.category <> 'late_fee'
      AND COALESCE(fl.term, '') !~ '^year_[2-9]';
    RETURN NEXT; RETURN;
  END IF;

  SELECT COALESCE((public.lead_fee_status(_lead_id) ->> 'paid_toward_course')::numeric, 0)
    INTO net_collected;

  v_fs := public.lead_fee_structure_id(_lead_id);
  IF v_fs IS NOT NULL THEN
    SELECT COALESCE(SUM(fsi.amount), 0) INTO net_first_year
    FROM public.fee_structure_items fsi
    JOIN public.fee_codes fc ON fc.id = fsi.fee_code_id
    WHERE fsi.fee_structure_id = v_fs
      AND fc.category <> 'enrollment'
      AND fc.category <> 'late_fee'
      AND COALESCE(fsi.term, '') !~ '^year_[2-9]';
  ELSE
    net_first_year := 0;
  END IF;
  RETURN NEXT;
END $$;

CREATE OR REPLACE FUNCTION public.recompute_consultant_payout(_lead_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE
  v_consultant_id uuid; v_course_id uuid; v_model text; v_ctype text;
  v_paid numeric; v_value numeric; v_annual numeric; v_payout numeric; v_pct numeric;
  v_ovr_type text; v_ovr_value numeric;
BEGIN
  SELECT consultant_id, course_id, consultant_commission_type, consultant_commission_value
    INTO v_consultant_id, v_course_id, v_ovr_type, v_ovr_value
  FROM public.leads WHERE id = _lead_id;
  IF v_consultant_id IS NULL THEN RETURN; END IF;

  SELECT payout_model::text INTO v_model FROM public.consultants WHERE id = v_consultant_id;

  SELECT b.net_collected, b.net_first_year INTO v_paid, v_annual
  FROM public.consultant_lead_fee_base(_lead_id) b;
  v_paid := COALESCE(v_paid, 0); v_annual := COALESCE(v_annual, 0);

  IF v_model = 'fee_collection' OR v_model IS NULL OR v_paid <= 0 OR v_course_id IS NULL THEN
    DELETE FROM public.consultant_payouts WHERE consultant_id = v_consultant_id AND lead_id = _lead_id;
    RETURN;
  END IF;

  IF v_ovr_value IS NOT NULL THEN
    v_ctype := COALESCE(v_ovr_type, 'percentage');
    v_value := v_ovr_value;
  ELSE
    SELECT commission_type, commission_value INTO v_ctype, v_value
    FROM public.consultant_commissions WHERE consultant_id = v_consultant_id AND course_id = v_course_id;
    IF NOT FOUND THEN
      SELECT commission_type, commission_value INTO v_ctype, v_value FROM public.consultants WHERE id = v_consultant_id;
    END IF;
  END IF;
  v_value := COALESCE(v_value, 0);

  IF v_ctype = 'percentage' THEN
    v_payout := round(v_value / 100.0 * v_paid, 2);
  ELSIF v_annual > 0 THEN
    v_payout := round(v_value * LEAST(v_paid, v_annual) / v_annual, 2);
  ELSE
    v_payout := v_value;
  END IF;

  v_pct := CASE WHEN v_annual > 0 THEN LEAST(100, round(v_paid / v_annual * 100, 2)) ELSE 0 END;

  IF v_payout <= 0 THEN
    DELETE FROM public.consultant_payouts WHERE consultant_id = v_consultant_id AND lead_id = _lead_id;
    RETURN;
  END IF;

  INSERT INTO public.consultant_payouts (
    consultant_id, lead_id, course_id, commission_type, commission_value,
    student_fee_paid, annual_fee, fee_paid_pct, payout_amount, status
  ) VALUES (
    v_consultant_id, _lead_id, v_course_id, COALESCE(v_ctype, v_model), v_value,
    v_paid, v_annual, v_pct, v_payout, 'pending'
  )
  ON CONFLICT (consultant_id, lead_id) DO UPDATE SET
    course_id = EXCLUDED.course_id,
    commission_type = EXCLUDED.commission_type,
    commission_value = EXCLUDED.commission_value,
    student_fee_paid = EXCLUDED.student_fee_paid,
    annual_fee = EXCLUDED.annual_fee,
    fee_paid_pct = EXCLUDED.fee_paid_pct,
    payout_amount = CASE WHEN consultant_payouts.status = 'paid'
                         THEN consultant_payouts.payout_amount ELSE EXCLUDED.payout_amount END;
END $function$;

CREATE OR REPLACE FUNCTION public.trg_fee_ledger_consultant_payout()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_lead uuid;
BEGIN
  SELECT lead_id INTO v_lead FROM public.students WHERE id = COALESCE(NEW.student_id, OLD.student_id);
  IF v_lead IS NOT NULL THEN PERFORM public.recompute_consultant_payout(v_lead); END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS fee_ledger_consultant_payout ON public.fee_ledger;
CREATE TRIGGER fee_ledger_consultant_payout
AFTER INSERT OR DELETE OR UPDATE OF paid_amount, concession, total_amount ON public.fee_ledger
FOR EACH ROW EXECUTE FUNCTION public.trg_fee_ledger_consultant_payout();

DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT id FROM public.leads WHERE consultant_id IS NOT NULL LOOP
    PERFORM public.recompute_consultant_payout(r.id);
  END LOOP;
END $$;
