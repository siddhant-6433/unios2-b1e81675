-- Day Closer — end-of-day cash-desk close + 9AM–6PM cash-receipt window.
--
-- Rules (see plan):
--  * A non-super_admin may create a *cash* receipt only while the IST clock is
--    in [09:00, 18:00) AND the day has not been closed for that receipt's campus.
--  * super_admin is exempt from both the window and the close block, always.
--  * Closing keys on the IST date, so it lifts at the next IST midnight and the
--    09:00 window then re-gates — i.e. "disabled until 9 AM tomorrow" for free.
--  * A cashier (accountant) or super_admin triggers the close, optionally per
--    campus; super_admin can close *all* (a single NULL-campus row that blocks
--    every campus, including campus-less leads).
--
-- Enforcement is a BEFORE INSERT trigger on the two cash write paths
-- (lead_payments + post-admission payments) PLUS a UI gate that reads the same
-- predicate. Only cash + a logged-in non-super_admin is gated: service-role /
-- cron / edge inserts (auth.uid() IS NULL) and every non-cash mode pass through
-- untouched, so gateway-settlement and automated flows are never blocked.

-- 1. Closure ledger -----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.day_closures (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campus_id   uuid REFERENCES public.campuses(id),   -- NULL = all campuses (super_admin global close)
  closed_date date NOT NULL,                          -- IST date
  closed_by   uuid REFERENCES public.profiles(id),
  closed_at   timestamptz NOT NULL DEFAULT now()
);

-- Treat NULL campus as a real value for uniqueness so a global close can't be
-- double-inserted (plain UNIQUE(campus_id, date) lets NULLs duplicate).
CREATE UNIQUE INDEX IF NOT EXISTS day_closures_campus_date_uq
  ON public.day_closures (COALESCE(campus_id, '00000000-0000-0000-0000-000000000000'::uuid), closed_date);

ALTER TABLE public.day_closures ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS day_closures_select ON public.day_closures;
CREATE POLICY day_closures_select ON public.day_closures
  FOR SELECT TO authenticated USING (true);
-- No write policy: rows are written only through close_day() (SECURITY DEFINER).
GRANT SELECT ON public.day_closures TO authenticated;

-- 2. Shared predicate: may the current user create a cash receipt now? --------
-- Single source of truth for both the UI gate and the DB trigger, so they
-- cannot drift. Returns { allowed: bool, reason: text }.
CREATE OR REPLACE FUNCTION public.can_create_cash_receipt(_campus_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hour  int;
  v_today date;
BEGIN
  IF public.has_role(auth.uid(), 'super_admin') THEN
    RETURN jsonb_build_object('allowed', true, 'reason', NULL);
  END IF;

  v_hour  := EXTRACT(HOUR FROM now() AT TIME ZONE 'Asia/Kolkata')::int;
  v_today := (now() AT TIME ZONE 'Asia/Kolkata')::date;

  IF v_hour < 9 OR v_hour >= 18 THEN
    RETURN jsonb_build_object('allowed', false,
      'reason', 'Cash receipts can only be recorded between 9 AM and 6 PM.');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.day_closures dc
    WHERE dc.closed_date = v_today
      AND (dc.campus_id IS NULL OR dc.campus_id = _campus_id)
  ) THEN
    RETURN jsonb_build_object('allowed', false,
      'reason', 'The day has been closed for this campus. Cash receipts reopen at 9 AM tomorrow.');
  END IF;

  RETURN jsonb_build_object('allowed', true, 'reason', NULL);
END;
$$;

GRANT EXECUTE ON FUNCTION public.can_create_cash_receipt(uuid) TO authenticated;

-- 3. Hard-block trigger on both cash write paths ------------------------------
CREATE OR REPLACE FUNCTION public.enforce_cash_receipt_window()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_campus uuid;
  v_check  jsonb;
BEGIN
  -- Exempt automated inserts (service-role / cron / edge have no auth.uid()).
  IF auth.uid() IS NULL THEN RETURN NEW; END IF;
  IF NEW.payment_mode <> 'cash' THEN RETURN NEW; END IF;

  IF TG_TABLE_NAME = 'lead_payments' THEN
    -- Only confirmed cash receipts count (pending rows aren't collections yet).
    IF NEW.status IS DISTINCT FROM 'confirmed' THEN RETURN NEW; END IF;
    SELECT l.campus_id INTO v_campus FROM public.leads l WHERE l.id = NEW.lead_id;
  ELSE  -- public.payments (post-admission student cash)
    SELECT s.campus_id INTO v_campus FROM public.students s WHERE s.id = NEW.student_id;
  END IF;

  v_check := public.can_create_cash_receipt(v_campus);
  IF NOT (v_check->>'allowed')::boolean THEN
    RAISE EXCEPTION '%', v_check->>'reason' USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_cash_receipt_window ON public.lead_payments;
CREATE TRIGGER trg_enforce_cash_receipt_window
  BEFORE INSERT ON public.lead_payments
  FOR EACH ROW EXECUTE FUNCTION public.enforce_cash_receipt_window();

DROP TRIGGER IF EXISTS trg_enforce_cash_receipt_window ON public.payments;
CREATE TRIGGER trg_enforce_cash_receipt_window
  BEFORE INSERT ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.enforce_cash_receipt_window();

-- 4. close_day() — record the closure(s) --------------------------------------
CREATE OR REPLACE FUNCTION public.close_day(_campus_ids uuid[] DEFAULT NULL, _all boolean DEFAULT false)
RETURNS TABLE (campus_id uuid, campus_name text, closed_date date)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid      uuid    := auth.uid();
  v_today    date    := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_is_super boolean := public.has_role(v_uid, 'super_admin');
  v_cid      uuid;
BEGIN
  IF NOT (v_is_super OR public.has_role(v_uid, 'accountant')) THEN
    RAISE EXCEPTION 'Only an accountant or super_admin can close the day';
  END IF;

  IF _all THEN
    IF v_is_super THEN
      -- Global close: one NULL-campus row blocks every campus (incl. campus-less leads).
      INSERT INTO public.day_closures (campus_id, closed_date, closed_by)
      VALUES (NULL, v_today, v_uid)
      ON CONFLICT (COALESCE(campus_id, '00000000-0000-0000-0000-000000000000'::uuid), closed_date) DO NOTHING;
    ELSE
      -- Accountant "all" = every campus they are assigned to.
      FOREACH v_cid IN ARRAY COALESCE(public.user_assigned_campus_ids(v_uid), ARRAY[]::uuid[]) LOOP
        INSERT INTO public.day_closures (campus_id, closed_date, closed_by)
        VALUES (v_cid, v_today, v_uid)
        ON CONFLICT (COALESCE(campus_id, '00000000-0000-0000-0000-000000000000'::uuid), closed_date) DO NOTHING;
      END LOOP;
    END IF;
  ELSE
    IF _campus_ids IS NULL OR array_length(_campus_ids, 1) IS NULL THEN
      RAISE EXCEPTION 'Select at least one campus to close, or use close-all';
    END IF;
    FOREACH v_cid IN ARRAY _campus_ids LOOP
      IF NOT v_is_super AND NOT public.user_can_access_assigned_campus(v_uid, v_cid) THEN
        RAISE EXCEPTION 'You are not allowed to close this campus';
      END IF;
      INSERT INTO public.day_closures (campus_id, closed_date, closed_by)
      VALUES (v_cid, v_today, v_uid)
      ON CONFLICT (COALESCE(campus_id, '00000000-0000-0000-0000-000000000000'::uuid), closed_date) DO NOTHING;
    END LOOP;
  END IF;

  RETURN QUERY
    SELECT dc.campus_id, c.name, dc.closed_date
    FROM public.day_closures dc
    LEFT JOIN public.campuses c ON c.id = dc.campus_id
    WHERE dc.closed_date = v_today AND dc.closed_by = v_uid;
END;
$$;

GRANT EXECUTE ON FUNCTION public.close_day(uuid[], boolean) TO authenticated;

-- 5. Offline collection for the day-close report ------------------------------
-- Clone of get_daily_fee_collection, but adds admission_no, restricts to
-- offline-recorded receipts, and optionally scopes to one campus. New function
-- (not a signature change) to avoid overload ambiguity with the cron caller.
-- p_campus_ids: NULL/empty = all campuses; else restrict to those campuses (an
-- accountant closing "all" closes their assigned set, not a global row).
CREATE OR REPLACE FUNCTION public.get_offline_collection(
  p_from timestamptz, p_to timestamptz, p_campus_ids uuid[] DEFAULT NULL
) RETURNS TABLE (
  paid_at timestamptz, receipt_no text, person_name text, admission_no text,
  course_name text, campus_name text, payment_mode text,
  amount numeric, fee_type text, gateway text, source text, cashier_name text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT vap.paid_at, vap.receipt_no, vap.person_name,
         COALESCE(vap.admission_no, vap.pre_admission_no) AS admission_no,
         co.name AS course_name, ca.name AS campus_name,
         vap.payment_mode, vap.amount, vap.fee_type, vap.gateway, vap.source,
         pr.display_name AS cashier_name
  FROM public.v_all_payments vap
  LEFT JOIN public.campuses ca ON ca.id = vap.campus_id
  LEFT JOIN public.profiles pr ON pr.id = vap.recorded_by
  LEFT JOIN public.students st ON st.id = vap.student_id
  LEFT JOIN public.leads    ld ON ld.id = vap.lead_id
  LEFT JOIN public.courses  co ON co.id = COALESCE(st.course_id, ld.course_id)
  WHERE vap.paid_at >= p_from AND vap.paid_at < p_to
    AND vap.gateway = 'offline'
    AND (p_campus_ids IS NULL OR array_length(p_campus_ids, 1) IS NULL
         OR vap.campus_id = ANY(p_campus_ids))
  ORDER BY vap.payment_mode, vap.paid_at;
$$;

REVOKE ALL ON FUNCTION public.get_offline_collection(timestamptz, timestamptz, uuid[]) FROM public;
GRANT EXECUTE ON FUNCTION public.get_offline_collection(timestamptz, timestamptz, uuid[]) TO service_role;

NOTIFY pgrst, 'reload schema';
