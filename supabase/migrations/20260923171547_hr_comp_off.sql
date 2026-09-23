-- Comp-off (compensatory off).
--
-- Time worked beyond the norm earns a credit that can be taken back as leave.
-- Credits are approved by HR, expire after a configurable window, and are
-- consumed FIFO when an approved leave request of type COFF is recorded.

-- ── Config ──────────────────────────────────────────────────────────────────

INSERT INTO public.payroll_statutory_config (legal_entity_id, key, numeric_value, note)
SELECT NULL, v.key, v.val, v.note
FROM (VALUES
  ('comp_off_hours_per_day', 8::numeric,  'Hours of overtime that earn one comp-off day'),
  ('comp_off_expiry_months', 6::numeric,  'Months before an unused comp-off credit expires')
) AS v(key, val, note)
WHERE NOT EXISTS (
  SELECT 1 FROM public.payroll_statutory_config c
   WHERE c.legal_entity_id IS NULL AND c.key = v.key
);

CREATE OR REPLACE FUNCTION public.hr_config_number(_key text, _default numeric)
RETURNS numeric
LANGUAGE sql STABLE AS $$
  SELECT COALESCE(
    (SELECT numeric_value FROM public.payroll_statutory_config
      WHERE key = _key AND legal_entity_id IS NULL
      ORDER BY effective_from DESC LIMIT 1),
    _default);
$$;

-- ── Table ───────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.comp_off_credits (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_profile_id     uuid NOT NULL REFERENCES public.employee_profiles(id) ON DELETE CASCADE,
  earned_on               date NOT NULL DEFAULT CURRENT_DATE,
  days                    numeric(6,2) NOT NULL CHECK (days > 0),
  used_days               numeric(6,2) NOT NULL DEFAULT 0 CHECK (used_days >= 0),
  remaining               numeric(6,2) GENERATED ALWAYS AS (GREATEST(days - used_days, 0)) STORED,
  reason                  text,
  source                  text NOT NULL DEFAULT 'manual'
                            CHECK (source IN ('overtime', 'holiday_work', 'weekend', 'manual')),
  attendance_overtime_id  uuid REFERENCES public.attendance_overtime(id) ON DELETE SET NULL,
  status                  text NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending', 'approved', 'rejected', 'used', 'expired')),
  approved_by             uuid REFERENCES auth.users(id),
  approved_at             timestamptz,
  expires_on              date,
  notes                   text,
  created_by              uuid REFERENCES auth.users(id),
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS comp_off_credits_employee_idx
  ON public.comp_off_credits (employee_profile_id, status, earned_on);
CREATE INDEX IF NOT EXISTS comp_off_credits_expiry_idx
  ON public.comp_off_credits (expires_on) WHERE status = 'approved';

ALTER TABLE public.comp_off_credits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "People read own comp-off" ON public.comp_off_credits;
CREATE POLICY "People read own comp-off"
  ON public.comp_off_credits FOR SELECT TO authenticated
  USING (
    (SELECT public.has_permission(auth.uid(), 'hr:view'))
    OR (SELECT public.has_permission(auth.uid(), 'hr:attendance_edit'))
    OR EXISTS (SELECT 1 FROM public.employee_profiles e
                WHERE e.id = comp_off_credits.employee_profile_id AND e.user_id = auth.uid())
  );

DROP POLICY IF EXISTS "HR manages comp-off" ON public.comp_off_credits;
CREATE POLICY "HR manages comp-off"
  ON public.comp_off_credits FOR ALL TO authenticated
  USING ((SELECT public.has_permission(auth.uid(), 'hr:attendance_edit')))
  WITH CHECK ((SELECT public.has_permission(auth.uid(), 'hr:attendance_edit')));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.comp_off_credits TO authenticated;
GRANT ALL ON public.comp_off_credits TO service_role;

CREATE OR REPLACE FUNCTION public.tg_comp_off_credits_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_comp_off_credits_touch ON public.comp_off_credits;
CREATE TRIGGER trg_comp_off_credits_touch
  BEFORE UPDATE ON public.comp_off_credits
  FOR EACH ROW EXECUTE FUNCTION public.tg_comp_off_credits_touch();

-- ── COFF leave type per plan ────────────────────────────────────────────────

INSERT INTO public.leave_types (leave_plan_id, code, name, annual_days, accrual, carry_forward_max, is_paid, requires_approval, display_order)
SELECT lp.id, 'COFF', 'Comp Off', 0, 'annual', 0, true, true, 90
FROM public.leave_plans lp
WHERE NOT EXISTS (
  SELECT 1 FROM public.leave_types t WHERE t.leave_plan_id = lp.id AND t.code = 'COFF'
);

-- ── RPCs ────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.grant_comp_off(
  _employee_profile_id uuid, _days numeric, _earned_on date DEFAULT CURRENT_DATE,
  _reason text DEFAULT NULL, _source text DEFAULT 'manual',
  _attendance_overtime_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_id uuid; v_uid uuid;
BEGIN
  IF NOT (public.has_permission(auth.uid(), 'hr:attendance_edit')
          OR public.has_role(auth.uid(), 'super_admin'::public.app_role)) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;
  IF _days IS NULL OR _days <= 0 THEN RAISE EXCEPTION 'Comp-off days must be positive'; END IF;

  INSERT INTO public.comp_off_credits
    (employee_profile_id, days, earned_on, reason, source, attendance_overtime_id, status, created_by)
  VALUES (_employee_profile_id, _days, COALESCE(_earned_on, CURRENT_DATE), _reason, _source, _attendance_overtime_id, 'approved', auth.uid())
  RETURNING id INTO v_id;

  -- Approving at grant time sets the expiry window.
  UPDATE public.comp_off_credits
     SET expires_on = (COALESCE(_earned_on, CURRENT_DATE) + (public.hr_config_number('comp_off_expiry_months', 6)::int * interval '1 month'))::date,
         approved_by = auth.uid(), approved_at = now()
   WHERE id = v_id;

  SELECT user_id INTO v_uid FROM public.employee_profiles WHERE id = _employee_profile_id;
  IF v_uid IS NOT NULL THEN
    INSERT INTO public.notifications (user_id, type, title, body, link)
    VALUES (v_uid, 'general', 'Comp-off credited',
            _days || ' comp-off day(s) credited to you.', '/my-hr');
  END IF;

  RETURN v_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.grant_comp_off(uuid, numeric, date, text, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.grant_comp_off(uuid, numeric, date, text, text, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.decide_comp_off(_credit_id uuid, _approve boolean, _note text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE c public.comp_off_credits;
BEGIN
  IF NOT (public.has_permission(auth.uid(), 'hr:attendance_edit')
          OR public.has_role(auth.uid(), 'super_admin'::public.app_role)) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  SELECT * INTO c FROM public.comp_off_credits WHERE id = _credit_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Comp-off credit not found'; END IF;
  IF c.status <> 'pending' THEN RAISE EXCEPTION 'Comp-off is already %', c.status; END IF;

  UPDATE public.comp_off_credits
     SET status = CASE WHEN _approve THEN 'approved' ELSE 'rejected' END,
         approved_by = auth.uid(), approved_at = now(),
         expires_on = CASE WHEN _approve
           THEN (c.earned_on + (public.hr_config_number('comp_off_expiry_months', 6)::int * interval '1 month'))::date
           ELSE expires_on END,
         notes = COALESCE(_note, notes)
   WHERE id = _credit_id;

  RETURN CASE WHEN _approve THEN 'approved' ELSE 'rejected' END;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.decide_comp_off(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.decide_comp_off(uuid, boolean, text) TO authenticated, service_role;

-- Consume approved credits FIFO. Internal: called by the leave-approval trigger.
CREATE OR REPLACE FUNCTION public.consume_comp_off(_employee_profile_id uuid, _days numeric)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c record;
  v_left numeric := GREATEST(_days, 0);
  v_take numeric;
BEGIN
  FOR c IN
    SELECT id, remaining FROM public.comp_off_credits
     WHERE employee_profile_id = _employee_profile_id
       AND status = 'approved'
       AND remaining > 0
       AND (expires_on IS NULL OR expires_on >= CURRENT_DATE)
     ORDER BY earned_on ASC, created_at ASC
     FOR UPDATE
  LOOP
    EXIT WHEN v_left <= 0;
    v_take := LEAST(c.remaining, v_left);
    UPDATE public.comp_off_credits
       SET used_days = used_days + v_take,
           status = CASE WHEN used_days + v_take >= days THEN 'used' ELSE 'approved' END
     WHERE id = c.id;
    v_left := v_left - v_take;
  END LOOP;
  RETURN GREATEST(_days, 0) - v_left;  -- days actually consumed
END;
$$;

REVOKE EXECUTE ON FUNCTION public.consume_comp_off(uuid, numeric) FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.tg_leave_consume_comp_off()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_code text; v_profile uuid;
BEGIN
  IF NEW.status <> 'approved' OR OLD.status = 'approved' THEN RETURN NEW; END IF;

  SELECT t.code INTO v_code FROM public.leave_types t WHERE t.id = NEW.leave_type_id;
  v_code := COALESCE(v_code, upper(NEW.leave_type));
  IF v_code <> 'COFF' THEN RETURN NEW; END IF;

  v_profile := NEW.employee_profile_id;
  IF v_profile IS NULL AND NEW.user_id IS NOT NULL THEN
    SELECT id INTO v_profile FROM public.employee_profiles WHERE user_id = NEW.user_id;
  END IF;
  IF v_profile IS NOT NULL THEN
    PERFORM public.consume_comp_off(v_profile, NEW.days);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS leave_requests_consume_comp_off ON public.employee_leave_requests;
CREATE TRIGGER leave_requests_consume_comp_off
  AFTER UPDATE OF status ON public.employee_leave_requests
  FOR EACH ROW EXECUTE FUNCTION public.tg_leave_consume_comp_off();

-- Auto-credit when an overtime entry is approved.
CREATE OR REPLACE FUNCTION public.tg_overtime_grant_comp_off()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_days numeric;
BEGIN
  IF NEW.status <> 'approved' OR (TG_OP = 'UPDATE' AND OLD.status = 'approved') THEN RETURN NEW; END IF;
  IF NEW.hours IS NULL OR NEW.hours <= 0 THEN RETURN NEW; END IF;

  v_days := round(NEW.hours / GREATEST(public.hr_config_number('comp_off_hours_per_day', 8), 1), 2);
  IF v_days <= 0 THEN RETURN NEW; END IF;

  INSERT INTO public.comp_off_credits
    (employee_profile_id, days, earned_on, reason, source, attendance_overtime_id, status, approved_by, approved_at, expires_on)
  VALUES (NEW.employee_profile_id, v_days, NEW.date, COALESCE(NEW.reason, 'Overtime'), 'overtime', NEW.id, 'approved',
          auth.uid(), now(),
          (NEW.date + (public.hr_config_number('comp_off_expiry_months', 6)::int * interval '1 month'))::date)
  ON CONFLICT DO NOTHING;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS overtime_grant_comp_off ON public.attendance_overtime;
CREATE TRIGGER overtime_grant_comp_off
  AFTER INSERT OR UPDATE OF status ON public.attendance_overtime
  FOR EACH ROW EXECUTE FUNCTION public.tg_overtime_grant_comp_off();

-- ── Expiry worker + schedule ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.expire_comp_off_credits()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_count integer;
BEGIN
  UPDATE public.comp_off_credits
     SET status = 'expired'
   WHERE status = 'approved'
     AND expires_on IS NOT NULL
     AND expires_on < CURRENT_DATE
     AND remaining > 0;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.expire_comp_off_credits() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.expire_comp_off_credits() TO service_role;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'hr-comp-off-expiry') THEN
    PERFORM cron.unschedule('hr-comp-off-expiry');
  END IF;
  PERFORM cron.schedule('hr-comp-off-expiry', '10 3 * * *',
    $$SELECT public.expire_comp_off_credits()$$);
END;
$$;

-- ── Self-service balance ────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.my_comp_off()
RETURNS TABLE (approved_days numeric, used_days numeric, available_days numeric, next_expiry date)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_profile uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT id INTO v_profile FROM public.employee_profiles WHERE user_id = auth.uid();
  IF v_profile IS NULL THEN RETURN; END IF;

  RETURN QUERY
  SELECT COALESCE(sum(days) FILTER (WHERE status IN ('approved', 'used')), 0),
         COALESCE(sum(used_days) FILTER (WHERE status IN ('approved', 'used')), 0),
         COALESCE(sum(remaining) FILTER (WHERE status = 'approved'
                  AND (expires_on IS NULL OR expires_on >= CURRENT_DATE)), 0),
         min(expires_on) FILTER (WHERE status = 'approved' AND remaining > 0)
    FROM public.comp_off_credits
   WHERE employee_profile_id = v_profile;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.my_comp_off() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.my_comp_off() TO authenticated, service_role;
