-- ====================================================================
-- 1. Incentive config v2: achievable daily KPI targets + advisory gate
-- 2. Visit time-out: checked_out_at + visit_check_out RPC
-- 3. Direct walk-ins: create_walk_in_visit(_source)
-- 4. Forgotten-checkout prevention: auto-checkout on resumed calling
--    (call_logs trigger) + nightly 6 PM IST sweep (pg_cron)
-- ====================================================================

-- 1a. Config v2 (policy §20: amend by inserting a new version) -------------
-- fresh_calls 80→60, followup_calls 100→40, KPI gate becomes advisory
-- (visible on statements, never blocks eligibility).
INSERT INTO public.incentive_config (version, config)
SELECT 2, jsonb_set(jsonb_set(jsonb_set(config,
  '{daily_kpi_targets,fresh_calls}', '60'),
  '{daily_kpi_targets,followup_calls}', '40'),
  '{eligibility,kpi_gate_advisory}', 'true')
FROM public.incentive_config
WHERE version = 1
  AND NOT EXISTS (SELECT 1 FROM public.incentive_config WHERE version = 2);

-- 1b. Advisory-aware month close -------------------------------------------
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
  v_kpi_advisory boolean := coalesce((v_cfg->'eligibility'->>'kpi_gate_advisory')::boolean, false);
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
    IF EXISTS (SELECT 1 FROM public.incentive_statements
               WHERE counsellor_id = v_c.counsellor_id AND month = v_month AND status IN ('approved', 'paid')) THEN
      CONTINUE;
    END IF;

    v_targets := public.fn_counsellor_targets(v_c.counsellor_id, v_month);

    -- clawed-back (refunded) admissions don't count toward the target or earn adjustments
    SELECT count(*) INTO v_adm_count FROM public.incentive_ledger il
    WHERE il.counsellor_id = v_c.counsellor_id AND il.month = v_month AND il.component = 'base' AND il.amount >= 0
      AND NOT EXISTS (SELECT 1 FROM public.incentive_ledger c WHERE c.lead_id = il.lead_id AND c.component = 'clawback');

    SELECT coalesce(sum(lp.amount), 0) INTO v_revenue
    FROM public.lead_payments lp
    JOIN public.leads l ON l.id = lp.lead_id
    WHERE l.counsellor_id = v_c.counsellor_id
      AND lp.status = 'confirmed'
      AND lp.type IN (SELECT jsonb_array_elements_text(v_cfg->'qualifying_payment_types'))
      AND date_trunc('month', lp.payment_date)::date = v_month;

    IF v_adm_count = 0 AND v_revenue = 0
       AND NOT EXISTS (SELECT 1 FROM public.incentive_ledger WHERE counsellor_id = v_c.counsellor_id AND month = v_month) THEN
      CONTINUE;
    END IF;

    v_adm_pct := round(100.0 * v_adm_count / greatest((v_targets->>'admission_target')::numeric, 1), 2);
    v_rev_pct := round(100.0 * v_revenue / greatest((v_targets->>'revenue_target')::numeric, 1), 2);
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
      'kpi_compliance', jsonb_build_object('value', v_kpi, 'advisory', v_kpi_advisory,
                         'pass', CASE WHEN v_kpi IS NULL THEN NULL
                                      ELSE v_kpi >= (v_cfg->'eligibility'->>'min_kpi_pct')::numeric END),
      'no_disciplinary_action', jsonb_build_object('value', coalesce(v_inputs.disciplinary_action, false),
                         'pass', NOT coalesce(v_inputs.disciplinary_action, false))
    );
    -- eligible = no non-advisory gate known-failed; NULL (pending input) gates resolved at approval
    v_eligible := NOT EXISTS (
      SELECT 1 FROM jsonb_each(v_gates) g
      WHERE (g.value->>'pass') = 'false'
        AND NOT coalesce((g.value->>'advisory')::boolean, false)
    );

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

  -- Team bonus (policy §12)
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

-- 1c. Advisory flag in the dashboard snapshot ------------------------------
-- Only the gates object changes; body otherwise identical to 20260711120000.
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
    AND date_trunc('month', lp.payment_date)::date = v_month;

  v_adm_pct := round(100.0 * v_adm / greatest((v_targets->>'admission_target')::numeric, 1), 2);
  v_rev_pct := round(100.0 * v_revenue / greatest((v_targets->>'revenue_target')::numeric, 1), 2);
  v_achievement := least(v_adm_pct, v_rev_pct);
  v_mult := public.fn_multiplier_for(v_achievement);

  FOR v_band IN SELECT * FROM jsonb_array_elements(v_cfg->'multiplier_bands') LOOP
    IF (v_band->>'min')::numeric > v_achievement AND v_next_band IS NULL THEN
      v_next_band := v_band;
    END IF;
  END LOOP;

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
      'kpi_compliance', jsonb_build_object('value', v_kpi, 'required', (v_cfg->'eligibility'->>'min_kpi_pct')::numeric,
        'advisory', coalesce((v_cfg->'eligibility'->>'kpi_gate_advisory')::boolean, false)),
      'attendance', jsonb_build_object('value', v_attendance, 'required', (v_cfg->'eligibility'->>'min_attendance_pct')::numeric)
    )
  );
END;
$$;

-- 2. Visit check-out --------------------------------------------------------
ALTER TABLE public.campus_visits
  ADD COLUMN IF NOT EXISTS checked_out_at timestamptz;

COMMENT ON COLUMN public.campus_visits.checked_out_at IS 'When the visitor left campus (manual check-out, call-resume auto-checkout, or 6 PM sweep).';

CREATE OR REPLACE FUNCTION public.visit_check_out(_visit_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_lead_id uuid;
BEGIN
  UPDATE public.campus_visits
     SET checked_out_at = COALESCE(checked_out_at, now()),
         updated_at = now()
   WHERE id = _visit_id AND checked_in_at IS NOT NULL
   RETURNING lead_id INTO v_lead_id;

  IF v_lead_id IS NOT NULL THEN
    INSERT INTO public.lead_activities (lead_id, user_id, type, description)
    VALUES (v_lead_id,
            (SELECT id FROM public.profiles WHERE user_id = auth.uid() LIMIT 1),
            'visit', 'Visitor checked out');
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION public.visit_check_out(uuid) TO authenticated, service_role;

-- 3. Direct walk-ins: recreate create_walk_in_visit with a _source param ----
-- DROP first: adding a defaulted param via CREATE OR REPLACE would create an
-- ambiguous overload alongside the old 7-arg signature.
DROP FUNCTION IF EXISTS public.create_walk_in_visit(text,text,text,uuid,uuid,text,text);

CREATE OR REPLACE FUNCTION public.create_walk_in_visit(
  _name       text,
  _phone      text,
  _email      text        DEFAULT NULL,
  _course_id  uuid        DEFAULT NULL,
  _campus_id  uuid        DEFAULT NULL,
  _purpose    text        DEFAULT NULL,
  _notes      text        DEFAULT NULL,
  _source     lead_source DEFAULT 'walk_in'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile_id  uuid;
  v_session_id  uuid;
  v_lead_id     uuid;
  v_visit_id    uuid;
  v_clean_phone text := regexp_replace(COALESCE(_phone, ''), '\D', '', 'g');
BEGIN
  IF _name IS NULL OR btrim(_name) = '' THEN
    RAISE EXCEPTION 'Name is required';
  END IF;
  IF v_clean_phone = '' THEN
    RAISE EXCEPTION 'Phone is required';
  END IF;
  IF _source NOT IN ('walk_in', 'direct_walkin') THEN
    RAISE EXCEPTION 'Walk-in source must be walk_in or direct_walkin';
  END IF;

  SELECT id INTO v_profile_id FROM public.profiles WHERE user_id = auth.uid() LIMIT 1;

  SELECT id INTO v_session_id FROM public.admission_sessions
   WHERE is_active = true ORDER BY start_date DESC LIMIT 1;

  -- Dedupe by phone (last 10 digits match).
  SELECT id INTO v_lead_id
    FROM public.leads
   WHERE regexp_replace(phone, '\D', '', 'g') = v_clean_phone
   ORDER BY created_at DESC
   LIMIT 1;

  IF v_lead_id IS NULL THEN
    INSERT INTO public.leads (
      name, phone, email, course_id, campus_id,
      source, counsellor_id, session_id, notes
    ) VALUES (
      btrim(_name), _phone, NULLIF(btrim(COALESCE(_email, '')), ''),
      _course_id, _campus_id,
      _source, v_profile_id, v_session_id, _notes
    )
    RETURNING id INTO v_lead_id;
  ELSE
    -- Existing lead: keep counsellor, refresh contact context if empty.
    UPDATE public.leads
       SET email      = COALESCE(NULLIF(btrim(COALESCE(_email, '')), ''), email),
           course_id  = COALESCE(_course_id, course_id),
           campus_id  = COALESCE(_campus_id, campus_id)
     WHERE id = v_lead_id;
  END IF;

  INSERT INTO public.campus_visits (
    lead_id, campus_id, scheduled_by, visit_date, status,
    visit_type, checked_in_at, purpose, feedback
  ) VALUES (
    v_lead_id, COALESCE(_campus_id, (SELECT campus_id FROM public.leads WHERE id = v_lead_id)),
    auth.uid(), now(), 'completed',
    'walk_in', now(), _purpose, _notes
  )
  RETURNING id INTO v_visit_id;

  INSERT INTO public.lead_activities (lead_id, user_id, type, description)
  VALUES (v_lead_id, v_profile_id, 'visit',
          CASE WHEN _source = 'direct_walkin' THEN 'Direct walk-in recorded' ELSE 'Walk-in recorded' END
          || COALESCE(' — ' || _purpose, ''));

  RETURN jsonb_build_object('lead_id', v_lead_id, 'visit_id', v_visit_id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_walk_in_visit(text,text,text,uuid,uuid,text,text,lead_source)
  TO authenticated, service_role;

-- 4a. Auto-checkout when calling resumes on a lead --------------------------
CREATE OR REPLACE FUNCTION public.fn_visit_checkout_on_call()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_visit record;
BEGIN
  IF NEW.direction <> 'outbound' THEN RETURN NEW; END IF;

  FOR v_visit IN
    SELECT id, lead_id FROM public.campus_visits
    WHERE lead_id = NEW.lead_id
      AND checked_in_at IS NOT NULL
      AND checked_out_at IS NULL
      AND checked_in_at <= COALESCE(NEW.called_at, now())
  LOOP
    UPDATE public.campus_visits
       SET checked_out_at = COALESCE(NEW.called_at, now()), updated_at = now()
     WHERE id = v_visit.id;
    -- type 'visit': prod's lead_activities_type_check predates the repo's
    -- 'system' value (constraint drift) — 'visit' is valid everywhere
    INSERT INTO public.lead_activities (lead_id, type, description)
    VALUES (v_visit.lead_id, 'visit', 'Visitor auto checked out (calling resumed)');
  END LOOP;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_visit_checkout_on_call
  AFTER INSERT ON public.call_logs
  FOR EACH ROW EXECUTE FUNCTION public.fn_visit_checkout_on_call();

-- 4b. Nightly 6 PM IST sweep for forgotten check-outs -----------------------
CREATE OR REPLACE FUNCTION public.visit_auto_checkout()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_count integer;
BEGIN
  IF auth.uid() IS NOT NULL
     AND NOT (has_role(auth.uid(), 'super_admin') OR has_role(auth.uid(), 'admission_head')) THEN
    RAISE EXCEPTION 'Not authorised';
  END IF;

  WITH closed AS (
    UPDATE public.campus_visits
       SET checked_out_at = now(), updated_at = now()
     WHERE checked_in_at IS NOT NULL AND checked_out_at IS NULL
     RETURNING lead_id
  )
  INSERT INTO public.lead_activities (lead_id, type, description)
  SELECT lead_id, 'visit', 'Visitor auto checked out (end-of-day sweep)' FROM closed;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

SELECT cron.unschedule('visit-auto-checkout')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'visit-auto-checkout');

-- 12:30 UTC = 6:00 PM IST
SELECT cron.schedule('visit-auto-checkout', '30 12 * * *', $$SELECT public.visit_auto_checkout()$$);

-- 5. Visit scheduling ≥2h rule (anti-gaming: no retroactive scheduling) ------
-- Scheduled visits must have visit_date ≥ created_at + 2h. Walk-ins are exempt
-- (they're created with status='completed' + checked_in_at already set).
CREATE OR REPLACE FUNCTION public.fn_enforce_visit_schedule_lead_time()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.visit_type = 'walk_in' OR NEW.status = 'completed' THEN RETURN NEW; END IF;
  IF NEW.visit_date < NEW.created_at + interval '2 hours' THEN
    RAISE EXCEPTION 'Visits must be scheduled at least 2 hours in advance';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_visit_schedule_lead_time
  BEFORE INSERT ON public.campus_visits
  FOR EACH ROW EXECUTE FUNCTION public.fn_enforce_visit_schedule_lead_time();

-- 6. Walk-in incentive cap: no pre-scheduled visit → 50% max ----------------
-- Override fn_try_accrue_incentive: if the lead was admitted via a walk-in
-- (no completed scheduled visit booked ≥2h before), cap source_pct at 50%.
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
  v_has_scheduled_visit boolean;
BEGIN
  SELECT * INTO v_lead FROM public.leads WHERE id = p_lead_id;
  IF NOT FOUND OR v_lead.counsellor_id IS NULL OR v_lead.stage::text <> 'admitted' THEN RETURN; END IF;

  IF EXISTS (SELECT 1 FROM public.incentive_ledger WHERE lead_id = p_lead_id AND component = 'base' AND amount >= 0) THEN
    RETURN;
  END IF;

  SELECT max(payment_date) INTO v_qualifying_date
  FROM public.lead_payments
  WHERE lead_id = p_lead_id AND status = 'confirmed'
    AND type IN (SELECT jsonb_array_elements_text(v_cfg->'qualifying_payment_types'))
    AND amount >= (v_cfg->>'min_qualifying_fee')::numeric;
  IF v_qualifying_date IS NULL THEN RETURN; END IF;

  v_month := date_trunc('month', v_qualifying_date)::date;
  v_hold := (v_qualifying_date + make_interval(days => (v_cfg->>'clawback_days')::integer))::date;
  v_course := public.fn_course_base_incentive(v_lead.course_id);
  v_src := public.fn_lead_source_class(v_lead.source::text);
  v_base := (v_course->>'amount')::numeric;

  -- A visit counts as "legitimately scheduled" only if a counsellor (human)
  -- booked it ≥2h before the visit and it was completed.
  -- Automation/Navya visits (scheduled_by IS NULL) are treated as walk-ins.
  SELECT EXISTS (
    SELECT 1 FROM public.campus_visits cv
    WHERE cv.lead_id = p_lead_id
      AND cv.visit_type = 'scheduled'
      AND cv.status = 'completed'
      AND cv.visit_date >= cv.created_at + interval '2 hours'
      AND cv.scheduled_by IS NOT NULL
      AND EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = cv.scheduled_by AND ur.role = 'counsellor')
  ) INTO v_has_scheduled_visit;

  IF v_src->>'class' = 'consultant' THEN
    v_amount := (v_src->>'flat')::numeric;
    v_pct := NULL;
  ELSE
    v_pct := (v_src->>'pct')::numeric;
    -- Walk-in cap: no pre-scheduled visit → cap at 50% regardless of source
    IF NOT v_has_scheduled_visit AND v_pct > 50 THEN
      v_pct := 50;
    END IF;
    v_amount := round(v_base * v_pct / 100.0, 2);
  END IF;

  INSERT INTO public.incentive_ledger (counsellor_id, lead_id, month, component, amount, calc_inputs, hold_until)
  VALUES (v_lead.counsellor_id, p_lead_id, v_month, 'base', v_amount,
    jsonb_build_object(
      'course', v_course->>'label', 'course_base', v_base,
      'source', v_lead.source::text, 'source_class', v_src->>'class', 'source_pct', v_pct,
      'has_scheduled_visit', v_has_scheduled_visit,
      'qualifying_date', v_qualifying_date, 'config_version', public.fn_incentive_config_version()
    ), v_hold);

  IF v_src->>'class' <> 'consultant' AND v_base > 0 THEN
    v_hours := EXTRACT(EPOCH FROM (v_qualifying_date - v_lead.created_at)) / 3600.0;
    IF v_hours <= 48 THEN
      v_speed := (v_cfg->'speed_bonus'->>'within_48h')::numeric;
    ELSIF v_hours <= 168 THEN
      v_speed := (v_cfg->'speed_bonus'->>'within_7d')::numeric;
    END IF;
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

  IF v_src->>'class' = 'self_generated'
     AND EXTRACT(EPOCH FROM (v_qualifying_date - v_lead.created_at)) / 3600.0 < (v_cfg->>'fast_self_gen_flag_hours')::numeric
     AND v_speed_note IS NULL THEN
    INSERT INTO public.incentive_flags (counsellor_id, lead_id, flag_type, details)
    VALUES (v_lead.counsellor_id, p_lead_id, 'fast_self_gen_conversion',
      jsonb_build_object('hours_from_creation', round(EXTRACT(EPOCH FROM (v_qualifying_date - v_lead.created_at)) / 3600.0, 1)));
  END IF;
END;
$$;
