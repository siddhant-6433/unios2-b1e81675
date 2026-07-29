-- Counsellor Incentive Engine
-- Implements NIMT Admission Counsellor Performance, Target & Incentive Policy v2.0
-- Event-sourced ledger + monthly statements + anti-gaming flags + dashboard RPCs.
-- All rupee figures / percentages / thresholds live in incentive_config (policy §20).

-- ============================================================
-- 1. Versioned policy configuration
-- ============================================================
CREATE TABLE public.incentive_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version integer NOT NULL UNIQUE,
  config jsonb NOT NULL,
  effective_from date NOT NULL DEFAULT current_date,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.incentive_config (version, config) VALUES (1, '{
  "course_incentives": [
    {"match": "NURSING",              "amount": 0,    "label": "B.Sc Nursing"},
    {"match": "\\mBPT\\M",            "amount": 500,  "label": "BPT"},
    {"match": "\\mBMRIT\\M",          "amount": 500,  "label": "BMRIT"},
    {"match": "\\mMBA\\M",            "amount": 3000, "label": "MBA"},
    {"match": "\\mPGDM\\M",           "amount": 3000, "label": "PGDM"},
    {"match": "LL\\.? ?B",            "amount": 2500, "label": "BA LL.B"},
    {"match": "\\mBBA\\M",            "amount": 2000, "label": "BBA"},
    {"match": "\\mBCA\\M",            "amount": 2000, "label": "BCA"},
    {"match": "\\mGNM\\M",            "amount": 2000, "label": "GNM"},
    {"match": "\\mB\\.? ?ED\\M",      "amount": 1500, "label": "B.Ed"},
    {"match": "D\\.? ?EL\\.? ?ED",    "amount": 1500, "label": "D.El.Ed"}
  ],
  "default_course_incentive": 1000,
  "source_classes": {
    "self_generated":         {"pct": 100, "sources": ["referral"]},
    "institutional_outreach": {"pct": 90,  "sources": ["education_fair", "school_outreach"]},
    "digital":                {"pct": 80,  "sources": ["website", "meta_ads", "google_ads", "shiksha", "justdial", "collegedunia", "collegehai", "mirai_website", "salahlo", "whatsapp", "website_chat", "inbound_call", "dialer", "other"]},
    "walk_in":                {"pct": 50,  "sources": ["walk_in", "direct_walkin"]},
    "consultant":             {"flat": 500, "sources": ["consultant"]}
  },
  "multiplier_bands": [
    {"min": 0,   "max": 70,   "mult": 0},
    {"min": 70,  "max": 90,   "mult": 0.75},
    {"min": 90,  "max": 100,  "mult": 1.0},
    {"min": 100, "max": 110,  "mult": 1.25},
    {"min": 110, "max": 125,  "mult": 1.5},
    {"min": 125, "max": 150,  "mult": 1.75},
    {"min": 150, "max": null, "mult": 2.0}
  ],
  "speed_bonus": {"within_48h": 500, "within_7d": 250, "min_crm_age_hours_self_gen": 48},
  "token_bonus": 100,
  "volume_slabs": [
    {"min_admissions": 5,  "bonus": 1000},
    {"min_admissions": 10, "bonus": 2500},
    {"min_admissions": 15, "bonus": 5000},
    {"min_admissions": 20, "bonus": 10000},
    {"min_admissions": 30, "bonus": 20000}
  ],
  "team_bonus_slabs": [
    {"min_campus_pct": 100, "bonus": 3000},
    {"min_campus_pct": 120, "bonus": 7500},
    {"min_campus_pct": 150, "bonus": 15000}
  ],
  "eligibility": {
    "min_admission_pct": 70,
    "min_revenue_pct": 70,
    "min_attendance_pct": 95,
    "min_kpi_pct": 90,
    "achievement_basis": "min"
  },
  "designation_targets": {
    "junior_counsellor": {"admissions": 10, "revenue": 800000},
    "counsellor":        {"admissions": 12, "revenue": 1000000},
    "senior_counsellor": {"admissions": 15, "revenue": 1300000},
    "team_leader":       {"admissions": 12, "revenue": 1000000}
  },
  "daily_kpi_targets": {
    "fresh_calls": 80,
    "followup_calls": 100,
    "whatsapp_followups": 60,
    "meaningful_calls": 25,
    "visit_appointments": 8,
    "visits_conducted": 5,
    "applications_submitted": 3,
    "tokens_collected": 2
  },
  "meaningful_call_min_seconds": 120,
  "qualifying_payment_types": ["registration_fee", "token_fee"],
  "min_qualifying_fee": 0,
  "clawback_days": 45,
  "fast_self_gen_flag_hours": 72,
  "month_end_cluster_pct": 40
}'::jsonb);

CREATE OR REPLACE FUNCTION public.fn_incentive_config()
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT config FROM public.incentive_config ORDER BY version DESC LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.fn_incentive_config_version()
RETURNS integer LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT version FROM public.incentive_config ORDER BY version DESC LIMIT 1;
$$;

-- ============================================================
-- 2. Designations & monthly targets
-- ============================================================
CREATE TABLE public.counsellor_designations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  counsellor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  designation text NOT NULL CHECK (designation IN ('junior_counsellor', 'counsellor', 'senior_counsellor', 'team_leader')),
  monthly_admission_target integer,  -- NULL = use config default for designation
  monthly_revenue_target numeric(12,2),
  effective_from date NOT NULL DEFAULT current_date,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_designations_counsellor ON public.counsellor_designations(counsellor_id, effective_from DESC);

-- ============================================================
-- 3. Incentive ledger (append-only, event-sourced)
-- ============================================================
CREATE TABLE public.incentive_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  counsellor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  month date NOT NULL,  -- first day of the attribution month
  component text NOT NULL CHECK (component IN ('base', 'speed_bonus', 'token', 'multiplier_adjustment', 'volume_bonus', 'team_bonus', 'clawback', 'adjustment')),
  amount numeric(12,2) NOT NULL,
  calc_inputs jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'accrued' CHECK (status IN ('accrued', 'eligible', 'approved', 'paid', 'clawed_back', 'forfeited')),
  hold_until date,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_incentive_ledger_counsellor_month ON public.incentive_ledger(counsellor_id, month);
CREATE INDEX idx_incentive_ledger_lead ON public.incentive_ledger(lead_id) WHERE lead_id IS NOT NULL;
-- one base / speed / token accrual per lead, ever
CREATE UNIQUE INDEX uq_incentive_ledger_lead_component ON public.incentive_ledger(lead_id, component)
  WHERE component IN ('base', 'speed_bonus', 'token') AND amount >= 0;

-- ============================================================
-- 4. Monthly statements
-- ============================================================
CREATE TABLE public.incentive_statements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  counsellor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  month date NOT NULL,
  admission_count integer NOT NULL DEFAULT 0,
  revenue_realized numeric(12,2) NOT NULL DEFAULT 0,
  admission_target integer,
  revenue_target numeric(12,2),
  achievement_pct numeric(6,2),
  multiplier numeric(4,2),
  eligibility jsonb NOT NULL DEFAULT '{}',  -- per-gate {value, pass}
  is_eligible boolean NOT NULL DEFAULT false,
  gross numeric(12,2) NOT NULL DEFAULT 0,
  clawbacks numeric(12,2) NOT NULL DEFAULT 0,
  net numeric(12,2) NOT NULL DEFAULT 0,
  config_version integer,
  status text NOT NULL DEFAULT 'pending_approval' CHECK (status IN ('pending_approval', 'approved', 'paid')),
  approved_by uuid REFERENCES public.profiles(id),
  approved_at timestamptz,
  paid_at timestamptz,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (counsellor_id, month)
);

-- ============================================================
-- 5. HR month inputs (attendance, disciplinary)
-- ============================================================
CREATE TABLE public.incentive_month_inputs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  counsellor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  month date NOT NULL,
  attendance_pct numeric(5,2),
  disciplinary_action boolean NOT NULL DEFAULT false,
  notes text,
  entered_by uuid REFERENCES public.profiles(id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (counsellor_id, month)
);

-- ============================================================
-- 6. Anti-gaming flags
-- ============================================================
CREATE TABLE public.incentive_flags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  counsellor_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  flag_type text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'cleared', 'upheld')),
  resolved_by uuid REFERENCES public.profiles(id),
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_incentive_flags_open ON public.incentive_flags(counsellor_id, created_at DESC) WHERE status = 'open';

-- ============================================================
-- 7. Daily KPI snapshots (written by nightly cron)
-- ============================================================
CREATE TABLE public.counsellor_daily_kpis (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  counsellor_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  kpi_date date NOT NULL,
  fresh_calls integer NOT NULL DEFAULT 0,
  followup_calls integer NOT NULL DEFAULT 0,
  whatsapp_followups integer NOT NULL DEFAULT 0,
  meaningful_calls integer NOT NULL DEFAULT 0,
  visit_appointments integer NOT NULL DEFAULT 0,
  visits_conducted integer NOT NULL DEFAULT 0,
  applications_submitted integer NOT NULL DEFAULT 0,
  tokens_collected integer NOT NULL DEFAULT 0,
  crm_compliance_pct numeric(5,2),
  composite_pct numeric(5,2),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (counsellor_id, kpi_date)
);
CREATE INDEX idx_daily_kpis_counsellor ON public.counsellor_daily_kpis(counsellor_id, kpi_date DESC);

-- ============================================================
-- 8. Lead source lock + audit (loophole #1)
-- ============================================================
CREATE TABLE public.lead_source_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  old_source text NOT NULL,
  new_source text NOT NULL,
  changed_by uuid,  -- auth.uid(); NULL for service-role/system changes
  changed_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.fn_lock_lead_source()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.source IS DISTINCT FROM OLD.source THEN
    -- service-role/system changes (auth.uid() IS NULL) are allowed but audited
    IF auth.uid() IS NOT NULL
       AND NOT (has_role(auth.uid(), 'super_admin') OR has_role(auth.uid(), 'admission_head')) THEN
      RAISE EXCEPTION 'Lead source is locked after creation. Ask an admission head to change it.';
    END IF;
    INSERT INTO public.lead_source_audit (lead_id, old_source, new_source, changed_by)
    VALUES (NEW.id, OLD.source::text, NEW.source::text, auth.uid());
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_lock_lead_source
  BEFORE UPDATE ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.fn_lock_lead_source();

-- Duplicate-phone self-generated lead flag (loopholes #1/#10/#11)
CREATE OR REPLACE FUNCTION public.fn_flag_self_gen_duplicate()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cfg jsonb := public.fn_incentive_config();
  v_dup uuid;
BEGIN
  IF v_cfg IS NULL THEN RETURN NEW; END IF;
  IF (v_cfg->'source_classes'->'self_generated'->'sources') ? NEW.source::text THEN
    SELECT id INTO v_dup FROM public.leads
    WHERE phone = NEW.phone AND id <> NEW.id
    ORDER BY created_at ASC LIMIT 1;
    IF v_dup IS NOT NULL THEN
      INSERT INTO public.incentive_flags (counsellor_id, lead_id, flag_type, details)
      VALUES (NEW.counsellor_id, NEW.id, 'duplicate_phone_self_gen',
        jsonb_build_object('existing_lead_id', v_dup, 'phone', NEW.phone));
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_flag_self_gen_duplicate
  AFTER INSERT ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.fn_flag_self_gen_duplicate();

-- ============================================================
-- 9. Pricing helpers
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_course_base_incentive(p_course_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cfg jsonb := public.fn_incentive_config();
  v_name text;
  v_item jsonb;
BEGIN
  SELECT upper(coalesce(name, '') || ' ' || coalesce(code, '')) INTO v_name
  FROM public.courses WHERE id = p_course_id;
  IF v_name IS NULL THEN
    RETURN jsonb_build_object('amount', (v_cfg->>'default_course_incentive')::numeric, 'label', 'Unknown course');
  END IF;
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_cfg->'course_incentives') LOOP
    IF v_name ~* (v_item->>'match') THEN
      RETURN jsonb_build_object('amount', (v_item->>'amount')::numeric, 'label', v_item->>'label');
    END IF;
  END LOOP;
  RETURN jsonb_build_object('amount', (v_cfg->>'default_course_incentive')::numeric, 'label', 'Other UG/PG');
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_lead_source_class(p_source text)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cfg jsonb := public.fn_incentive_config();
  v_key text;
  v_val jsonb;
BEGIN
  FOR v_key, v_val IN SELECT * FROM jsonb_each(v_cfg->'source_classes') LOOP
    IF (v_val->'sources') ? p_source THEN
      RETURN jsonb_build_object('class', v_key, 'pct', v_val->'pct', 'flat', v_val->'flat');
    END IF;
  END LOOP;
  -- unmapped sources default to digital treatment
  RETURN jsonb_build_object('class', 'digital', 'pct', v_cfg->'source_classes'->'digital'->'pct');
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_multiplier_for(p_achievement numeric)
RETURNS numeric LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_band jsonb;
BEGIN
  FOR v_band IN SELECT * FROM jsonb_array_elements(public.fn_incentive_config()->'multiplier_bands') LOOP
    IF p_achievement >= (v_band->>'min')::numeric
       AND (v_band->>'max' IS NULL OR p_achievement < (v_band->>'max')::numeric) THEN
      RETURN (v_band->>'mult')::numeric;
    END IF;
  END LOOP;
  RETURN 0;
END;
$$;

-- Effective targets for a counsellor (explicit override > designation default > 'counsellor' default)
CREATE OR REPLACE FUNCTION public.fn_counsellor_targets(p_counsellor_id uuid, p_month date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cfg jsonb := public.fn_incentive_config();
  v_row public.counsellor_designations%ROWTYPE;
  v_designation text := 'counsellor';
  v_adm integer;
  v_rev numeric;
BEGIN
  SELECT * INTO v_row FROM public.counsellor_designations
  WHERE counsellor_id = p_counsellor_id AND effective_from <= (p_month + interval '1 month' - interval '1 day')::date
  ORDER BY effective_from DESC LIMIT 1;
  IF FOUND THEN
    v_designation := v_row.designation;
    v_adm := v_row.monthly_admission_target;
    v_rev := v_row.monthly_revenue_target;
  END IF;
  v_adm := coalesce(v_adm, (v_cfg->'designation_targets'->v_designation->>'admissions')::integer, 12);
  v_rev := coalesce(v_rev, (v_cfg->'designation_targets'->v_designation->>'revenue')::numeric, 1000000);
  RETURN jsonb_build_object('designation', v_designation, 'admission_target', v_adm, 'revenue_target', v_rev);
END;
$$;

-- ============================================================
-- 10. Accrual engine
-- ============================================================
-- Accrues base (+speed) once a lead is admitted AND its qualifying fee is realized.
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

  v_month := date_trunc('month', v_qualifying_date)::date;
  v_hold := (v_qualifying_date + make_interval(days => (v_cfg->>'clawback_days')::integer))::date;
  v_course := public.fn_course_base_incentive(v_lead.course_id);
  v_src := public.fn_lead_source_class(v_lead.source::text);
  v_base := (v_course->>'amount')::numeric;

  IF v_src->>'class' = 'consultant' THEN
    -- flat amount, no speed bonus, no token bonus (policy §7)
    v_amount := (v_src->>'flat')::numeric;
    v_pct := NULL;
  ELSE
    v_pct := (v_src->>'pct')::numeric;
    v_amount := round(v_base * v_pct / 100.0, 2);
  END IF;

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

-- Token bonus (policy §9): accrues on confirmed token payment, once per lead, non-consultant.
-- Clawback (policy §9/§15): on refund of token/qualifying payments.
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

  -- Token accrual
  IF NEW.type = 'token_fee' AND NEW.status = 'confirmed' AND v_src->>'class' <> 'consultant'
     AND NOT EXISTS (SELECT 1 FROM public.incentive_ledger WHERE lead_id = NEW.lead_id AND component = 'token' AND amount >= 0) THEN
    INSERT INTO public.incentive_ledger (counsellor_id, lead_id, month, component, amount, calc_inputs, hold_until)
    VALUES (v_lead.counsellor_id, NEW.lead_id, v_month, 'token', (v_cfg->>'token_bonus')::numeric,
      jsonb_build_object('payment_id', NEW.id, 'payment_amount', NEW.amount),
      (NEW.payment_date + make_interval(days => (v_cfg->>'clawback_days')::integer))::date);
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

CREATE TRIGGER trg_incentive_on_payment
  AFTER INSERT OR UPDATE ON public.lead_payments
  FOR EACH ROW EXECUTE FUNCTION public.fn_incentive_on_payment();

-- Accrual attempt when a lead reaches 'admitted' (fee may already be realized)
CREATE OR REPLACE FUNCTION public.fn_incentive_on_admission()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF OLD.stage IS DISTINCT FROM NEW.stage AND NEW.stage::text = 'admitted' THEN
    PERFORM public.fn_try_accrue_incentive(NEW.id);
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_incentive_on_admission
  AFTER UPDATE ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.fn_incentive_on_admission();

-- ============================================================
-- 11. Month close (called by incentive-month-close-cron; rerunnable)
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
      AND date_trunc('month', lp.payment_date)::date = v_month;

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

-- ============================================================
-- 11b. Daily KPI snapshot (called by counsellor-score-cron nightly)
-- ============================================================
-- Policy §3C definitions made computable (loophole #9):
--   fresh call        = first outbound call ever logged to a lead
--   followup call     = any subsequent outbound call
--   meaningful call   = duration >= config seconds AND disposition recorded
--   crm compliance    = % of leads called that day whose call has a disposition
--   composite         = mean of min(actual/target, 1) across the 8 daily KPIs
CREATE OR REPLACE FUNCTION public.fn_snapshot_daily_kpis(p_date date DEFAULT current_date)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_cfg jsonb := public.fn_incentive_config();
  v_targets jsonb := public.fn_incentive_config()->'daily_kpi_targets';
  v_min_secs numeric := (public.fn_incentive_config()->>'meaningful_call_min_seconds')::numeric;
  v_rows integer;
BEGIN
  IF auth.uid() IS NOT NULL
     AND NOT (has_role(auth.uid(), 'super_admin') OR has_role(auth.uid(), 'admission_head')) THEN
    RAISE EXCEPTION 'Not authorised to snapshot daily KPIs';
  END IF;

  INSERT INTO public.counsellor_daily_kpis AS k
    (counsellor_id, kpi_date, fresh_calls, followup_calls, whatsapp_followups, meaningful_calls,
     visit_appointments, visits_conducted, applications_submitted, tokens_collected,
     crm_compliance_pct, composite_pct)
  SELECT
    p.id,
    p_date,
    coalesce(c.fresh_calls, 0),
    coalesce(c.followup_calls, 0),
    coalesce(w.whatsapps, 0),
    coalesce(c.meaningful_calls, 0),
    coalesce(va.appointments, 0),
    coalesce(vc.conducted, 0),
    coalesce(a.apps, 0),
    coalesce(t.tokens, 0),
    c.crm_compliance_pct,
    round((
      least(coalesce(c.fresh_calls, 0)::numeric / greatest((v_targets->>'fresh_calls')::numeric, 1), 1) +
      least(coalesce(c.followup_calls, 0)::numeric / greatest((v_targets->>'followup_calls')::numeric, 1), 1) +
      least(coalesce(w.whatsapps, 0)::numeric / greatest((v_targets->>'whatsapp_followups')::numeric, 1), 1) +
      least(coalesce(c.meaningful_calls, 0)::numeric / greatest((v_targets->>'meaningful_calls')::numeric, 1), 1) +
      least(coalesce(va.appointments, 0)::numeric / greatest((v_targets->>'visit_appointments')::numeric, 1), 1) +
      least(coalesce(vc.conducted, 0)::numeric / greatest((v_targets->>'visits_conducted')::numeric, 1), 1) +
      least(coalesce(a.apps, 0)::numeric / greatest((v_targets->>'applications_submitted')::numeric, 1), 1) +
      least(coalesce(t.tokens, 0)::numeric / greatest((v_targets->>'tokens_collected')::numeric, 1), 1)
    ) / 8.0 * 100, 2)
  FROM public.profiles p
  JOIN public.user_roles ur ON ur.user_id = p.user_id AND ur.role = 'counsellor'
  LEFT JOIN LATERAL (
    SELECT
      count(*) FILTER (WHERE cl.called_at = first_call.first_at) AS fresh_calls,
      count(*) FILTER (WHERE cl.called_at > first_call.first_at) AS followup_calls,
      count(*) FILTER (WHERE cl.duration_seconds >= v_min_secs AND cl.disposition IS NOT NULL) AS meaningful_calls,
      round(100.0 * count(*) FILTER (WHERE cl.disposition IS NOT NULL) / greatest(count(*), 1), 2) AS crm_compliance_pct
    FROM public.call_logs cl
    JOIN LATERAL (
      SELECT min(called_at) AS first_at FROM public.call_logs c2 WHERE c2.lead_id = cl.lead_id
    ) first_call ON true
    WHERE cl.user_id = p.user_id AND cl.called_at::date = p_date AND cl.direction = 'outbound'
  ) c ON true
  LEFT JOIN LATERAL (
    SELECT count(*) AS whatsapps FROM public.lead_activities la
    WHERE la.user_id = p.id AND la.type = 'whatsapp' AND la.created_at::date = p_date
  ) w ON true
  LEFT JOIN LATERAL (
    SELECT count(*) AS appointments FROM public.campus_visits cv
    WHERE cv.scheduled_by = p.user_id AND cv.created_at::date = p_date
  ) va ON true
  LEFT JOIN LATERAL (
    SELECT count(*) AS conducted FROM public.campus_visits cv
    JOIN public.leads l ON l.id = cv.lead_id
    WHERE l.counsellor_id = p.id AND cv.status = 'completed' AND cv.visit_date::date = p_date
  ) vc ON true
  LEFT JOIN LATERAL (
    SELECT count(*) AS apps FROM public.lead_activities la
    WHERE la.user_id = p.id AND la.type = 'status_change'
      AND la.new_stage::text = 'application_submitted' AND la.created_at::date = p_date
  ) a ON true
  LEFT JOIN LATERAL (
    SELECT count(*) AS tokens FROM public.lead_payments lp
    JOIN public.leads l ON l.id = lp.lead_id
    WHERE l.counsellor_id = p.id AND lp.type = 'token_fee' AND lp.status = 'confirmed'
      AND lp.payment_date::date = p_date
  ) t ON true
  ON CONFLICT (counsellor_id, kpi_date) DO UPDATE SET
    fresh_calls = EXCLUDED.fresh_calls,
    followup_calls = EXCLUDED.followup_calls,
    whatsapp_followups = EXCLUDED.whatsapp_followups,
    meaningful_calls = EXCLUDED.meaningful_calls,
    visit_appointments = EXCLUDED.visit_appointments,
    visits_conducted = EXCLUDED.visits_conducted,
    applications_submitted = EXCLUDED.applications_submitted,
    tokens_collected = EXCLUDED.tokens_collected,
    crm_compliance_pct = EXCLUDED.crm_compliance_pct,
    composite_pct = EXCLUDED.composite_pct;

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  RETURN v_rows;
END;
$$;

-- ============================================================
-- 12. Dashboard RPC: live incentive snapshot (gamification)
-- ============================================================
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

GRANT EXECUTE ON FUNCTION public.counsellor_incentive_snapshot() TO authenticated;

-- ============================================================
-- 13. Dashboard RPC: morning brief
-- ============================================================
CREATE OR REPLACE FUNCTION public.counsellor_morning_brief()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_me uuid;
  v_uid uuid := auth.uid();
  v_hot jsonb;
  v_sla jsonb;
  v_followups jsonb;
  v_overdue_count integer;
  v_visits jsonb;
  v_post_visit integer;
  v_apps jsonb;
  v_money jsonb;
  v_kpi jsonb;
BEGIN
  SELECT id INTO v_me FROM public.profiles WHERE user_id = v_uid;
  IF v_me IS NULL THEN RETURN NULL; END IF;

  -- Hot leads: priority_interested, most recently active first
  SELECT coalesce(jsonb_agg(t), '[]'::jsonb) INTO v_hot FROM (
    SELECT id, name, phone, stage::text AS stage, updated_at
    FROM public.leads
    WHERE counsellor_id = v_me AND stage::text = 'priority_interested'
    ORDER BY updated_at DESC LIMIT 5
  ) t;

  -- SLA breaches: uncontacted new leads older than 10 minutes
  SELECT coalesce(jsonb_agg(t), '[]'::jsonb) INTO v_sla FROM (
    SELECT id, name, phone, created_at,
      round(EXTRACT(EPOCH FROM (now() - created_at)) / 60.0) AS minutes_waiting
    FROM public.leads
    WHERE counsellor_id = v_me AND stage::text = 'new_lead'
      AND first_contact_at IS NULL AND created_at < now() - interval '10 minutes'
    ORDER BY created_at ASC LIMIT 5
  ) t;

  -- Today's + overdue follow-ups
  SELECT coalesce(jsonb_agg(t), '[]'::jsonb) INTO v_followups FROM (
    SELECT f.id, f.lead_id, l.name, l.phone, f.scheduled_at, f.type,
      (f.scheduled_at < now()) AS overdue
    FROM public.lead_followups f
    JOIN public.leads l ON l.id = f.lead_id
    WHERE f.user_id = v_uid AND f.status = 'pending'
      AND f.scheduled_at < (current_date + 1)::timestamptz
    ORDER BY f.scheduled_at ASC LIMIT 8
  ) t;
  SELECT count(*) INTO v_overdue_count FROM public.lead_followups
  WHERE user_id = v_uid AND status = 'pending' AND scheduled_at < now();

  -- Today's visits on my leads
  SELECT coalesce(jsonb_agg(t), '[]'::jsonb) INTO v_visits FROM (
    SELECT cv.id, cv.lead_id, l.name, l.phone, cv.visit_date, cv.status
    FROM public.campus_visits cv
    JOIN public.leads l ON l.id = cv.lead_id
    WHERE l.counsellor_id = v_me
      AND cv.visit_date >= current_date AND cv.visit_date < current_date + 1
      AND cv.status NOT IN ('cancelled')
    ORDER BY cv.visit_date ASC LIMIT 5
  ) t;

  -- Visits completed in the last 3 days with no follow-up logged since
  SELECT count(*) INTO v_post_visit
  FROM public.campus_visits cv
  JOIN public.leads l ON l.id = cv.lead_id
  WHERE l.counsellor_id = v_me AND cv.status = 'completed'
    AND cv.visit_date >= now() - interval '3 days'
    AND NOT EXISTS (
      SELECT 1 FROM public.lead_followups f
      WHERE f.lead_id = cv.lead_id AND f.created_at > cv.visit_date
    );

  -- Applications in flight
  SELECT coalesce(jsonb_agg(t), '[]'::jsonb) INTO v_apps FROM (
    SELECT id, name, phone, stage::text AS stage, updated_at
    FROM public.leads
    WHERE counsellor_id = v_me
      AND stage::text IN ('application_in_progress', 'application_submitted')
    ORDER BY updated_at DESC LIMIT 5
  ) t;

  -- Closest to money: token/application fee paid, not yet admitted
  SELECT coalesce(jsonb_agg(t), '[]'::jsonb) INTO v_money FROM (
    SELECT id, name, phone, stage::text AS stage, updated_at
    FROM public.leads
    WHERE counsellor_id = v_me
      AND stage::text IN ('token_paid', 'application_fee_paid', 'application_approved', 'offer_sent', 'pre_admitted')
    ORDER BY updated_at DESC LIMIT 5
  ) t;

  -- Yesterday's KPI scorecard
  SELECT to_jsonb(k) INTO v_kpi FROM (
    SELECT kpi_date, fresh_calls, followup_calls, whatsapp_followups, meaningful_calls,
           visit_appointments, visits_conducted, applications_submitted, tokens_collected, composite_pct
    FROM public.counsellor_daily_kpis
    WHERE counsellor_id = v_me AND kpi_date < current_date
    ORDER BY kpi_date DESC LIMIT 1
  ) k;

  RETURN jsonb_build_object(
    'hot_leads', v_hot,
    'sla_breaches', v_sla,
    'followups', v_followups,
    'overdue_followup_count', v_overdue_count,
    'visits_today', v_visits,
    'post_visit_pending', v_post_visit,
    'applications', v_apps,
    'closest_to_money', v_money,
    'yesterday_kpis', v_kpi
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.counsellor_morning_brief() TO authenticated;

-- ============================================================
-- 14. RLS (additive; new tables only)
-- ============================================================
CREATE OR REPLACE FUNCTION public.is_incentive_admin(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT has_role(_user_id, 'super_admin') OR has_role(_user_id, 'admission_head') OR has_role(_user_id, 'accountant');
$$;

ALTER TABLE public.incentive_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Authenticated can read incentive config" ON public.incentive_config
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "Admins manage incentive config" ON public.incentive_config
  FOR ALL TO authenticated USING (public.is_incentive_admin(auth.uid())) WITH CHECK (public.is_incentive_admin(auth.uid()));

ALTER TABLE public.counsellor_designations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own or admin read designations" ON public.counsellor_designations
  FOR SELECT TO authenticated USING (
    public.is_incentive_admin(auth.uid())
    OR counsellor_id IN (SELECT id FROM public.profiles WHERE user_id = auth.uid())
  );
CREATE POLICY "Admins manage designations" ON public.counsellor_designations
  FOR ALL TO authenticated USING (public.is_incentive_admin(auth.uid())) WITH CHECK (public.is_incentive_admin(auth.uid()));

ALTER TABLE public.incentive_ledger ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own or admin read ledger" ON public.incentive_ledger
  FOR SELECT TO authenticated USING (
    public.is_incentive_admin(auth.uid())
    OR counsellor_id IN (SELECT id FROM public.profiles WHERE user_id = auth.uid())
  );
CREATE POLICY "Admins insert ledger adjustments" ON public.incentive_ledger
  FOR INSERT TO authenticated WITH CHECK (public.is_incentive_admin(auth.uid()));

ALTER TABLE public.incentive_statements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own or admin read statements" ON public.incentive_statements
  FOR SELECT TO authenticated USING (
    public.is_incentive_admin(auth.uid())
    OR counsellor_id IN (SELECT id FROM public.profiles WHERE user_id = auth.uid())
  );
CREATE POLICY "Admins manage statements" ON public.incentive_statements
  FOR UPDATE TO authenticated USING (public.is_incentive_admin(auth.uid())) WITH CHECK (public.is_incentive_admin(auth.uid()));

ALTER TABLE public.incentive_month_inputs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage month inputs" ON public.incentive_month_inputs
  FOR ALL TO authenticated USING (public.is_incentive_admin(auth.uid())) WITH CHECK (public.is_incentive_admin(auth.uid()));
CREATE POLICY "Own read month inputs" ON public.incentive_month_inputs
  FOR SELECT TO authenticated USING (
    counsellor_id IN (SELECT id FROM public.profiles WHERE user_id = auth.uid())
  );

ALTER TABLE public.incentive_flags ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins manage flags" ON public.incentive_flags
  FOR ALL TO authenticated USING (public.is_incentive_admin(auth.uid())) WITH CHECK (public.is_incentive_admin(auth.uid()));

ALTER TABLE public.counsellor_daily_kpis ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Own or admin read daily kpis" ON public.counsellor_daily_kpis
  FOR SELECT TO authenticated USING (
    public.is_incentive_admin(auth.uid())
    OR counsellor_id IN (SELECT id FROM public.profiles WHERE user_id = auth.uid())
  );

ALTER TABLE public.lead_source_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Admins read source audit" ON public.lead_source_audit
  FOR SELECT TO authenticated USING (public.is_incentive_admin(auth.uid()));
