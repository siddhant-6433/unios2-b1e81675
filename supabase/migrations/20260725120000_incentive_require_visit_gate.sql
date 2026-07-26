-- Visit-gated + consultant-excluded counsellor incentives.
-- A lead only earns incentive if it has a COMPLETED campus visit (proxy for the
-- counsellor having actually worked it); consultant-source leads earn the counsellor
-- nothing (their separate consultant payout engine is untouched).
-- Config-driven & reversible: set incentive_config.require_visit_for_incentive=false
-- (and/or empty excluded_source_classes) to disable. Applied via Supabase MCP.

-- ============================================================
-- 1. Config version bump (carry forward + add gate knobs)
-- ============================================================
INSERT INTO public.incentive_config (version, config)
SELECT version + 1,
       config || jsonb_build_object(
         'require_visit_for_incentive', true,
         'qualifying_visit_statuses', jsonb_build_array('completed'),
         'excluded_source_classes', jsonb_build_array('consultant'))
FROM public.incentive_config ORDER BY version DESC LIMIT 1;

-- ============================================================
-- 2. Single eligibility gate: excluded source? or (visit required and none)?
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_lead_earns_incentive(p_lead_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cfg jsonb := public.fn_incentive_config();
  v_src jsonb;
BEGIN
  SELECT public.fn_lead_source_class(l.source::text) INTO v_src
  FROM public.leads l WHERE l.id = p_lead_id;
  IF v_src IS NULL THEN RETURN false; END IF;

  -- excluded source class (e.g. consultant) -> counsellor earns nothing
  IF (v_cfg->'excluded_source_classes') ? (v_src->>'class') THEN
    RETURN false;
  END IF;

  -- visit not required -> passes (backwards-compatible)
  IF NOT coalesce((v_cfg->>'require_visit_for_incentive')::boolean, false) THEN
    RETURN true;
  END IF;

  RETURN EXISTS (
    SELECT 1 FROM public.campus_visits cv
    WHERE cv.lead_id = p_lead_id
      AND cv.status IN (SELECT jsonb_array_elements_text(v_cfg->'qualifying_visit_statuses'))
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.fn_lead_earns_incentive(uuid) TO authenticated, service_role;

-- ============================================================
-- 3. Base + speed accrual, now gated (consultant flat branch removed)
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_try_accrue_incentive(p_lead_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cfg jsonb := public.fn_incentive_config();
  v_lead public.leads%ROWTYPE;
  v_qualifying_date timestamptz;
  v_course jsonb;
  v_src jsonb;
  v_base numeric;
  v_pct numeric;
  v_amount numeric;
  v_month date;
  v_hold date;
  v_hours numeric;
  v_speed numeric := 0;
  v_speed_note text;
BEGIN
  SELECT * INTO v_lead FROM public.leads WHERE id = p_lead_id;
  IF NOT FOUND OR v_lead.counsellor_id IS NULL OR v_lead.stage::text <> 'admitted' THEN RETURN; END IF;

  -- already accrued?
  IF EXISTS (SELECT 1 FROM public.incentive_ledger WHERE lead_id = p_lead_id AND component = 'base' AND amount >= 0) THEN
    RETURN;
  END IF;

  -- qualifying fee realized? (latest confirmed payment of a qualifying type)
  SELECT max(payment_date) INTO v_qualifying_date
  FROM public.lead_payments
  WHERE lead_id = p_lead_id AND status = 'confirmed'
    AND type IN (SELECT jsonb_array_elements_text(v_cfg->'qualifying_payment_types'))
    AND amount >= (v_cfg->>'min_qualifying_fee')::numeric;
  IF v_qualifying_date IS NULL THEN RETURN; END IF;

  -- visit / consultant gate: excluded source or no qualifying visit -> no accrual
  IF NOT public.fn_lead_earns_incentive(p_lead_id) THEN RETURN; END IF;

  v_month := date_trunc('month', v_qualifying_date)::date;
  v_hold := (v_qualifying_date + make_interval(days => (v_cfg->>'clawback_days')::integer))::date;
  v_course := public.fn_course_base_incentive(v_lead.course_id);
  v_src := public.fn_lead_source_class(v_lead.source::text);
  v_base := (v_course->>'amount')::numeric;

  -- consultant is excluded upstream by fn_lead_earns_incentive; pct path only
  v_pct := (v_src->>'pct')::numeric;
  v_amount := round(v_base * v_pct / 100.0, 2);

  INSERT INTO public.incentive_ledger (counsellor_id, lead_id, month, component, amount, calc_inputs, hold_until)
  VALUES (v_lead.counsellor_id, p_lead_id, v_month, 'base', v_amount,
    jsonb_build_object(
      'course', v_course->>'label', 'course_base', v_base,
      'source', v_lead.source::text, 'source_class', v_src->>'class', 'source_pct', v_pct,
      'qualifying_date', v_qualifying_date, 'config_version', public.fn_incentive_config_version()
    ), v_hold);

  -- Speed bonus (policy §10) — consultant excluded
  IF v_src->>'class' <> 'consultant' AND v_base > 0 THEN
    v_hours := EXTRACT(EPOCH FROM (v_qualifying_date - v_lead.created_at)) / 3600.0;
    IF v_hours <= 48 THEN
      v_speed := (v_cfg->'speed_bonus'->>'within_48h')::numeric;
    ELSIF v_hours <= 168 THEN
      v_speed := (v_cfg->'speed_bonus'->>'within_7d')::numeric;
    END IF;
    -- loophole #2: self-gen lead must have existed in CRM >= min age; otherwise no speed bonus + flag
    IF v_src->>'class' = 'self_generated'
       AND v_hours < (v_cfg->'speed_bonus'->>'min_crm_age_hours_self_gen')::numeric THEN
      v_speed := 0;
      v_speed_note := 'self_gen_min_crm_age_not_met';
      INSERT INTO public.incentive_flags (counsellor_id, lead_id, flag_type, details)
      VALUES (v_lead.counsellor_id, p_lead_id, 'fast_self_gen_conversion',
        jsonb_build_object('hours_from_creation', round(v_hours, 1)));
    END IF;
    IF v_speed > 0 THEN
      INSERT INTO public.incentive_ledger (counsellor_id, lead_id, month, component, amount, calc_inputs, hold_until)
      VALUES (v_lead.counsellor_id, p_lead_id, v_month, 'speed_bonus', v_speed,
        jsonb_build_object('hours_from_creation', round(v_hours, 1)), v_hold);
    END IF;
  END IF;

  -- loophole #1: self-gen admitted suspiciously fast after CRM creation
  IF v_src->>'class' = 'self_generated'
     AND EXTRACT(EPOCH FROM (v_qualifying_date - v_lead.created_at)) / 3600.0 < (v_cfg->>'fast_self_gen_flag_hours')::numeric
     AND v_speed_note IS NULL THEN
    INSERT INTO public.incentive_flags (counsellor_id, lead_id, flag_type, details)
    VALUES (v_lead.counsellor_id, p_lead_id, 'fast_self_gen_conversion',
      jsonb_build_object('hours_from_creation', round(EXTRACT(EPOCH FROM (v_qualifying_date - v_lead.created_at)) / 3600.0, 1)));
  END IF;
END;
$$;


-- ============================================================
-- 4b. Idempotent, gated token accrual (callable from payment + visit triggers)
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_try_accrue_token(p_lead_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cfg  jsonb := public.fn_incentive_config();
  v_lead public.leads%ROWTYPE;
  v_pay  public.lead_payments%ROWTYPE;
BEGIN
  SELECT * INTO v_lead FROM public.leads WHERE id = p_lead_id;
  IF NOT FOUND OR v_lead.counsellor_id IS NULL THEN RETURN; END IF;

  -- already accrued?
  IF EXISTS (SELECT 1 FROM public.incentive_ledger
             WHERE lead_id = p_lead_id AND component = 'token' AND amount >= 0) THEN
    RETURN;
  END IF;

  -- consultant exclusion + visit gate
  IF NOT public.fn_lead_earns_incentive(p_lead_id) THEN RETURN; END IF;

  -- earliest confirmed token_fee drives attribution month (stable across re-fires)
  SELECT * INTO v_pay FROM public.lead_payments
  WHERE lead_id = p_lead_id AND type = 'token_fee' AND status = 'confirmed'
  ORDER BY payment_date ASC, id ASC
  LIMIT 1;
  IF NOT FOUND THEN RETURN; END IF;

  INSERT INTO public.incentive_ledger (counsellor_id, lead_id, month, component, amount, calc_inputs, hold_until)
  VALUES (v_lead.counsellor_id, p_lead_id, date_trunc('month', v_pay.payment_date)::date, 'token',
    (v_cfg->>'token_bonus')::numeric,
    jsonb_build_object('payment_id', v_pay.id, 'payment_amount', v_pay.amount),
    (v_pay.payment_date + make_interval(days => (v_cfg->>'clawback_days')::integer))::date)
  ON CONFLICT DO NOTHING;  -- unique index uq_incentive_ledger_lead_component is the real guard
END;
$$;

-- ============================================================
-- 4c. Payment trigger fn (token block now delegates to fn_try_accrue_token)
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_incentive_on_payment()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cfg jsonb := public.fn_incentive_config();
  v_lead public.leads%ROWTYPE;
  v_src jsonb;
  v_month date;
  v_total numeric;
BEGIN
  SELECT * INTO v_lead FROM public.leads WHERE id = NEW.lead_id;
  IF NOT FOUND OR v_lead.counsellor_id IS NULL THEN RETURN NEW; END IF;
  v_src := public.fn_lead_source_class(v_lead.source::text);
  v_month := date_trunc('month', NEW.payment_date)::date;

  -- Token accrual (idempotent + visit/consultant-gated; see fn_try_accrue_token)
  IF NEW.type = 'token_fee' AND NEW.status = 'confirmed' THEN
    PERFORM public.fn_try_accrue_token(NEW.lead_id);
  END IF;

  -- Base/speed accrual attempt (fires when the qualifying fee lands after admission)
  IF NEW.status = 'confirmed' THEN
    PERFORM public.fn_try_accrue_incentive(NEW.lead_id);
  END IF;

  -- Refund clawback
  IF TG_OP = 'UPDATE' AND OLD.status <> 'refunded' AND NEW.status = 'refunded' THEN
    IF NEW.type = 'token_fee' THEN
      -- recover token bonus
      SELECT coalesce(sum(amount), 0) INTO v_total FROM public.incentive_ledger
      WHERE lead_id = NEW.lead_id AND component IN ('token');
      IF v_total > 0 THEN
        INSERT INTO public.incentive_ledger (counsellor_id, lead_id, month, component, amount, calc_inputs)
        VALUES (v_lead.counsellor_id, NEW.lead_id, date_trunc('month', now())::date, 'clawback', -v_total,
          jsonb_build_object('reason', 'token_refunded', 'payment_id', NEW.id));
      END IF;
    ELSIF NEW.type IN (SELECT jsonb_array_elements_text(v_cfg->'qualifying_payment_types'))
          AND now() <= NEW.payment_date + make_interval(days => (v_cfg->>'clawback_days')::integer) THEN
      -- policy §15: withdrawal within window recovers the ENTIRE incentive for the admission
      SELECT coalesce(sum(amount), 0) INTO v_total FROM public.incentive_ledger
      WHERE lead_id = NEW.lead_id AND component IN ('base', 'speed_bonus', 'multiplier_adjustment');
      IF v_total > 0 THEN
        INSERT INTO public.incentive_ledger (counsellor_id, lead_id, month, component, amount, calc_inputs)
        VALUES (v_lead.counsellor_id, NEW.lead_id, date_trunc('month', now())::date, 'clawback', -v_total,
          jsonb_build_object('reason', 'withdrawal_within_window', 'payment_id', NEW.id,
                             'days_after_payment', round(EXTRACT(EPOCH FROM (now() - NEW.payment_date)) / 86400.0)));
        INSERT INTO public.incentive_flags (counsellor_id, lead_id, flag_type, details)
        VALUES (v_lead.counsellor_id, NEW.lead_id, 'refund_clawback',
          jsonb_build_object('payment_id', NEW.id, 'amount_recovered', v_total));
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;


-- ============================================================
-- 5. Re-attempt accrual when a qualifying visit is marked AFTER payment/admission
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_incentive_on_visit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.status IN (SELECT jsonb_array_elements_text(
                      public.fn_incentive_config()->'qualifying_visit_statuses'))
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    PERFORM public.fn_try_accrue_incentive(NEW.lead_id);
    PERFORM public.fn_try_accrue_token(NEW.lead_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_incentive_on_visit ON public.campus_visits;
CREATE TRIGGER trg_incentive_on_visit
  AFTER INSERT OR UPDATE ON public.campus_visits
  FOR EACH ROW EXECUTE FUNCTION public.fn_incentive_on_visit();

-- ============================================================
-- 6. Month close (revenue sum now gated) + 6b live snapshot (revenue sum gated)
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_incentive_month_close(p_month date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cfg jsonb := public.fn_incentive_config();
  v_month date := date_trunc('month', p_month)::date;
  v_c record;
  v_targets jsonb;
  v_adm_count integer;
  v_revenue numeric;
  v_adm_pct numeric;
  v_rev_pct numeric;
  v_achievement numeric;
  v_mult numeric;
  v_gates jsonb;
  v_eligible boolean;
  v_inputs public.incentive_month_inputs%ROWTYPE;
  v_kpi numeric;
  v_gross numeric;
  v_claw numeric;
  v_net numeric;
  v_slab jsonb;
  v_volume numeric;
  v_base_row record;
  v_statements integer := 0;
  v_cluster_count integer;
  v_last3_count integer;
BEGIN
  -- caller must be service role (auth.uid() null) or an admin
  IF auth.uid() IS NOT NULL
     AND NOT (has_role(auth.uid(), 'super_admin') OR has_role(auth.uid(), 'admission_head') OR has_role(auth.uid(), 'accountant')) THEN
    RAISE EXCEPTION 'Not authorised to run incentive month close';
  END IF;

  -- Idempotency: remove derived rows + unapproved statements for the month
  DELETE FROM public.incentive_ledger il
  WHERE il.month = v_month
    AND il.component IN ('multiplier_adjustment', 'volume_bonus', 'team_bonus')
    AND NOT EXISTS (
      SELECT 1 FROM public.incentive_statements s
      WHERE s.counsellor_id = il.counsellor_id AND s.month = v_month AND s.status IN ('approved', 'paid')
    );
  DELETE FROM public.incentive_statements WHERE month = v_month AND status = 'pending_approval';

  FOR v_c IN
    SELECT DISTINCT counsellor_id FROM public.incentive_ledger WHERE month = v_month
    UNION
    SELECT DISTINCT counsellor_id FROM public.counsellor_designations
  LOOP
    -- skip already-approved statements
    IF EXISTS (SELECT 1 FROM public.incentive_statements
               WHERE counsellor_id = v_c.counsellor_id AND month = v_month AND status IN ('approved', 'paid')) THEN
      CONTINUE;
    END IF;

    v_targets := public.fn_counsellor_targets(v_c.counsellor_id, v_month);

    -- clawed-back (refunded) admissions don't count toward the target or earn adjustments
    SELECT count(*) INTO v_adm_count FROM public.incentive_ledger il
    WHERE il.counsellor_id = v_c.counsellor_id AND il.month = v_month AND il.component = 'base' AND il.amount >= 0
      AND NOT EXISTS (SELECT 1 FROM public.incentive_ledger c WHERE c.lead_id = il.lead_id AND c.component = 'clawback');

    -- revenue = realized qualifying payments on this counsellor's leads in the month
    SELECT coalesce(sum(lp.amount), 0) INTO v_revenue
    FROM public.lead_payments lp
    JOIN public.leads l ON l.id = lp.lead_id
    WHERE l.counsellor_id = v_c.counsellor_id
      AND lp.status = 'confirmed'
      AND lp.type IN (SELECT jsonb_array_elements_text(v_cfg->'qualifying_payment_types'))
      AND date_trunc('month', lp.payment_date)::date = v_month
      AND public.fn_lead_earns_incentive(l.id);

    -- nothing to report at all
    IF v_adm_count = 0 AND v_revenue = 0
       AND NOT EXISTS (SELECT 1 FROM public.incentive_ledger WHERE counsellor_id = v_c.counsellor_id AND month = v_month) THEN
      CONTINUE;
    END IF;

    v_adm_pct := round(100.0 * v_adm_count / greatest((v_targets->>'admission_target')::numeric, 1), 2);
    v_rev_pct := round(100.0 * v_revenue / greatest((v_targets->>'revenue_target')::numeric, 1), 2);
    -- loophole #3 codified: achievement = min(admission %, revenue %)
    v_achievement := least(v_adm_pct, v_rev_pct);
    v_mult := public.fn_multiplier_for(v_achievement);

    SELECT * INTO v_inputs FROM public.incentive_month_inputs
    WHERE counsellor_id = v_c.counsellor_id AND month = v_month;

    SELECT round(avg(composite_pct), 2) INTO v_kpi FROM public.counsellor_daily_kpis
    WHERE counsellor_id = v_c.counsellor_id
      AND kpi_date >= v_month AND kpi_date < (v_month + interval '1 month')::date;

    v_gates := jsonb_build_object(
      'admission_pct', jsonb_build_object('value', v_adm_pct, 'pass', v_adm_pct >= (v_cfg->'eligibility'->>'min_admission_pct')::numeric),
      'revenue_pct',   jsonb_build_object('value', v_rev_pct, 'pass', v_rev_pct >= (v_cfg->'eligibility'->>'min_revenue_pct')::numeric),
      'attendance',    jsonb_build_object('value', v_inputs.attendance_pct,
                         'pass', CASE WHEN v_inputs.attendance_pct IS NULL THEN NULL
                                      ELSE v_inputs.attendance_pct >= (v_cfg->'eligibility'->>'min_attendance_pct')::numeric END),
      'kpi_compliance', jsonb_build_object('value', v_kpi,
                         'pass', CASE WHEN v_kpi IS NULL THEN NULL
                                      ELSE v_kpi >= (v_cfg->'eligibility'->>'min_kpi_pct')::numeric END),
      'no_disciplinary_action', jsonb_build_object('value', coalesce(v_inputs.disciplinary_action, false),
                         'pass', NOT coalesce(v_inputs.disciplinary_action, false))
    );
    -- eligible = no gate known-failed; NULL (pending HR input) gates are resolved at approval time
    v_eligible := NOT EXISTS (
      SELECT 1 FROM jsonb_each(v_gates) g WHERE (g.value->>'pass') = 'false'
    );

    -- reprice base rows with the multiplier (loophole #4: base only; consultant flat excluded)
    IF v_eligible AND v_mult <> 1.0 THEN
      FOR v_base_row IN
        SELECT il.id, il.lead_id, il.amount, il.calc_inputs FROM public.incentive_ledger il
        WHERE il.counsellor_id = v_c.counsellor_id AND il.month = v_month AND il.component = 'base' AND il.amount >= 0
          AND (il.calc_inputs->>'source_class') <> 'consultant'
          AND NOT EXISTS (SELECT 1 FROM public.incentive_ledger c WHERE c.lead_id = il.lead_id AND c.component = 'clawback')
      LOOP
        INSERT INTO public.incentive_ledger (counsellor_id, lead_id, month, component, amount, calc_inputs)
        VALUES (v_c.counsellor_id, v_base_row.lead_id, v_month, 'multiplier_adjustment',
          round(v_base_row.amount * (v_mult - 1.0), 2),
          jsonb_build_object('multiplier', v_mult, 'base_row_id', v_base_row.id, 'achievement_pct', v_achievement));
      END LOOP;
    END IF;

    -- volume bonus (policy §11, reduced slabs per management recommendation)
    IF v_eligible THEN
      v_volume := 0;
      FOR v_slab IN SELECT * FROM jsonb_array_elements(v_cfg->'volume_slabs') LOOP
        IF v_adm_count >= (v_slab->>'min_admissions')::integer THEN
          v_volume := (v_slab->>'bonus')::numeric;
        END IF;
      END LOOP;
      IF v_volume > 0 THEN
        INSERT INTO public.incentive_ledger (counsellor_id, month, component, amount, calc_inputs)
        VALUES (v_c.counsellor_id, v_month, 'volume_bonus', v_volume,
          jsonb_build_object('admissions', v_adm_count));
      END IF;
    END IF;

    -- loophole #5: month-end clustering flag
    SELECT count(*) FILTER (WHERE (il.calc_inputs->>'qualifying_date')::timestamptz >= (v_month + interval '1 month' - interval '3 days')),
           count(*)
    INTO v_last3_count, v_cluster_count
    FROM public.incentive_ledger il
    WHERE il.counsellor_id = v_c.counsellor_id AND il.month = v_month AND il.component = 'base' AND il.amount >= 0
      AND NOT EXISTS (SELECT 1 FROM public.incentive_ledger c WHERE c.lead_id = il.lead_id AND c.component = 'clawback');
    IF v_cluster_count >= 3 AND v_last3_count * 100.0 / v_cluster_count > (v_cfg->>'month_end_cluster_pct')::numeric THEN
      INSERT INTO public.incentive_flags (counsellor_id, flag_type, details)
      VALUES (v_c.counsellor_id, 'month_end_clustering',
        jsonb_build_object('month', v_month, 'admissions_last_3_days', v_last3_count, 'total_admissions', v_cluster_count));
    END IF;

    SELECT coalesce(sum(amount) FILTER (WHERE amount > 0), 0),
           coalesce(sum(amount) FILTER (WHERE amount < 0), 0)
    INTO v_gross, v_claw
    FROM public.incentive_ledger
    WHERE counsellor_id = v_c.counsellor_id AND month = v_month;

    v_net := CASE WHEN v_eligible AND v_mult > 0 THEN v_gross + v_claw ELSE least(v_claw, 0) END;

    INSERT INTO public.incentive_statements
      (counsellor_id, month, admission_count, revenue_realized, admission_target, revenue_target,
       achievement_pct, multiplier, eligibility, is_eligible, gross, clawbacks, net, config_version)
    VALUES
      (v_c.counsellor_id, v_month, v_adm_count, v_revenue,
       (v_targets->>'admission_target')::integer, (v_targets->>'revenue_target')::numeric,
       v_achievement, v_mult, v_gates, v_eligible AND v_mult > 0, v_gross, v_claw, v_net,
       public.fn_incentive_config_version());
    v_statements := v_statements + 1;
  END LOOP;

  -- Team bonus (policy §12): campus achievement = campus admissions vs sum of member targets.
  -- Counsellor's campus = campus of the majority of their admitted leads this month.
  WITH counsellor_campus AS (
    SELECT DISTINCT ON (il.counsellor_id) il.counsellor_id, l.campus_id
    FROM public.incentive_ledger il
    JOIN public.leads l ON l.id = il.lead_id
    WHERE il.month = v_month AND il.component = 'base' AND il.amount >= 0 AND l.campus_id IS NOT NULL
    GROUP BY il.counsellor_id, l.campus_id
    ORDER BY il.counsellor_id, count(*) DESC
  ),
  campus_perf AS (
    SELECT cc.campus_id,
      sum(s.admission_count) AS adm,
      sum(s.admission_target) AS target
    FROM counsellor_campus cc
    JOIN public.incentive_statements s ON s.counsellor_id = cc.counsellor_id AND s.month = v_month
    GROUP BY cc.campus_id
  )
  INSERT INTO public.incentive_ledger (counsellor_id, month, component, amount, calc_inputs)
  SELECT s.counsellor_id, v_month, 'team_bonus',
    (SELECT max((slab->>'bonus')::numeric)
     FROM jsonb_array_elements(v_cfg->'team_bonus_slabs') slab
     WHERE 100.0 * cp.adm / greatest(cp.target, 1) >= (slab->>'min_campus_pct')::numeric),
    jsonb_build_object('campus_id', cp.campus_id, 'campus_achievement_pct', round(100.0 * cp.adm / greatest(cp.target, 1), 2))
  FROM public.incentive_statements s
  JOIN counsellor_campus cc ON cc.counsellor_id = s.counsellor_id
  JOIN campus_perf cp ON cp.campus_id = cc.campus_id
  WHERE s.month = v_month AND s.is_eligible AND s.status = 'pending_approval'
    AND 100.0 * cp.adm / greatest(cp.target, 1) >= (SELECT min((slab->>'min_campus_pct')::numeric) FROM jsonb_array_elements(v_cfg->'team_bonus_slabs') slab);

  -- fold team bonus into statement totals
  UPDATE public.incentive_statements s
  SET gross = sub.gross, net = CASE WHEN s.is_eligible THEN sub.gross + s.clawbacks ELSE s.net END
  FROM (
    SELECT counsellor_id, coalesce(sum(amount) FILTER (WHERE amount > 0), 0) AS gross
    FROM public.incentive_ledger WHERE month = v_month GROUP BY counsellor_id
  ) sub
  WHERE s.counsellor_id = sub.counsellor_id AND s.month = v_month AND s.status = 'pending_approval';

  RETURN jsonb_build_object('month', v_month, 'statements', v_statements);
END;
$$;

CREATE OR REPLACE FUNCTION public.counsellor_incentive_snapshot()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cfg jsonb := public.fn_incentive_config();
  v_me uuid;
  v_month date := date_trunc('month', now())::date;
  v_targets jsonb;
  v_adm integer;
  v_revenue numeric;
  v_adm_pct numeric;
  v_rev_pct numeric;
  v_achievement numeric;
  v_mult numeric;
  v_next_band jsonb;
  v_base_sum numeric;
  v_bonus_sum numeric;
  v_claw numeric;
  v_kpi numeric;
  v_attendance numeric;
  v_volume numeric := 0;
  v_next_slab jsonb;
  v_slab jsonb;
  v_band jsonb;
BEGIN
  SELECT id INTO v_me FROM public.profiles WHERE user_id = auth.uid();
  IF v_me IS NULL THEN RETURN NULL; END IF;

  v_targets := public.fn_counsellor_targets(v_me, v_month);

  SELECT count(*) FILTER (WHERE component = 'base' AND amount >= 0),
         coalesce(sum(amount) FILTER (WHERE component = 'base' AND amount >= 0), 0),
         coalesce(sum(amount) FILTER (WHERE component IN ('speed_bonus', 'token') AND amount >= 0), 0),
         coalesce(sum(amount) FILTER (WHERE amount < 0), 0)
  INTO v_adm, v_base_sum, v_bonus_sum, v_claw
  FROM public.incentive_ledger
  WHERE counsellor_id = v_me AND month = v_month;

  SELECT coalesce(sum(lp.amount), 0) INTO v_revenue
  FROM public.lead_payments lp
  JOIN public.leads l ON l.id = lp.lead_id
  WHERE l.counsellor_id = v_me AND lp.status = 'confirmed'
    AND lp.type IN (SELECT jsonb_array_elements_text(v_cfg->'qualifying_payment_types'))
    AND date_trunc('month', lp.payment_date)::date = v_month
      AND public.fn_lead_earns_incentive(l.id);

  v_adm_pct := round(100.0 * v_adm / greatest((v_targets->>'admission_target')::numeric, 1), 2);
  v_rev_pct := round(100.0 * v_revenue / greatest((v_targets->>'revenue_target')::numeric, 1), 2);
  v_achievement := least(v_adm_pct, v_rev_pct);
  v_mult := public.fn_multiplier_for(v_achievement);

  -- next multiplier band above current achievement
  FOR v_band IN SELECT * FROM jsonb_array_elements(v_cfg->'multiplier_bands') LOOP
    IF (v_band->>'min')::numeric > v_achievement AND v_next_band IS NULL THEN
      v_next_band := v_band;
    END IF;
  END LOOP;

  -- current + next volume slab
  FOR v_slab IN SELECT * FROM jsonb_array_elements(v_cfg->'volume_slabs') LOOP
    IF v_adm >= (v_slab->>'min_admissions')::integer THEN
      v_volume := (v_slab->>'bonus')::numeric;
    ELSIF v_next_slab IS NULL THEN
      v_next_slab := v_slab;
    END IF;
  END LOOP;

  SELECT round(avg(composite_pct), 2) INTO v_kpi FROM public.counsellor_daily_kpis
  WHERE counsellor_id = v_me AND kpi_date >= v_month;

  SELECT attendance_pct INTO v_attendance FROM public.incentive_month_inputs
  WHERE counsellor_id = v_me AND month = v_month;

  RETURN jsonb_build_object(
    'month', v_month,
    'designation', v_targets->>'designation',
    'admissions', v_adm,
    'admission_target', (v_targets->>'admission_target')::integer,
    'revenue', v_revenue,
    'revenue_target', (v_targets->>'revenue_target')::numeric,
    'admission_pct', v_adm_pct,
    'revenue_pct', v_rev_pct,
    'achievement_pct', v_achievement,
    'multiplier', v_mult,
    'next_band', v_next_band,
    'accrued_base', v_base_sum,
    'accrued_bonuses', v_bonus_sum,
    'clawbacks', v_claw,
    'volume_bonus', v_volume,
    'next_volume_slab', v_next_slab,
    'projected_net', CASE WHEN v_mult > 0
      THEN round(v_base_sum * v_mult + v_bonus_sum + v_volume + v_claw, 2)
      ELSE 0 END,
    'gates', jsonb_build_object(
      'admission_pct', jsonb_build_object('value', v_adm_pct, 'required', (v_cfg->'eligibility'->>'min_admission_pct')::numeric),
      'revenue_pct', jsonb_build_object('value', v_rev_pct, 'required', (v_cfg->'eligibility'->>'min_revenue_pct')::numeric),
      'kpi_compliance', jsonb_build_object('value', v_kpi, 'required', (v_cfg->'eligibility'->>'min_kpi_pct')::numeric),
      'attendance', jsonb_build_object('value', v_attendance, 'required', (v_cfg->'eligibility'->>'min_attendance_pct')::numeric)
    )
  );
END;
$$;


-- ============================================================
-- 7. One-time backfill: drop accruals that would NOT re-accrue under the new rules
--    (no-visit leads + consultant flat rows). Nothing is paid; fully re-derivable.
-- ============================================================
DELETE FROM public.incentive_ledger il
WHERE il.component IN ('base', 'speed_bonus', 'token')
  AND il.amount >= 0
  AND il.lead_id IS NOT NULL
  AND NOT public.fn_lead_earns_incentive(il.lead_id);
