-- After-hours cash receipts — campus-specific exceptions to the 9 AM–6 PM
-- window on chosen IST dates. Day close still blocks cash.
--
-- Rules:
--  * Default remains: a non-super_admin may record cash only in [09:00, 18:00)
--    IST, and only if the day is not closed for that campus.
--  * Only super_admin may grant or revoke an after-hours exception, for today
--    or up to 30 days ahead, per campus. "All campuses" writes a NULL-campus
--    row that covers every campus, including campus-less leads.
--  * The exception lifts only the clock. A closed day still blocks cash until
--    9 AM the next IST morning.
--  * super_admin remains fully exempt from both the window and the close.

-- 1. Exception ledger ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cash_window_exceptions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campus_id     uuid REFERENCES public.campuses(id),  -- NULL = all campuses
  allowed_date  date NOT NULL,                         -- IST date the 9–6 window is waived
  granted_by    uuid REFERENCES public.profiles(id),
  granted_at    timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS cash_window_exceptions_campus_date_uq
  ON public.cash_window_exceptions (
    COALESCE(campus_id, '00000000-0000-0000-0000-000000000000'::uuid),
    allowed_date
  );

ALTER TABLE public.cash_window_exceptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS cash_window_exceptions_select ON public.cash_window_exceptions;
CREATE POLICY cash_window_exceptions_select ON public.cash_window_exceptions
  FOR SELECT TO authenticated USING (true);
-- No write policy: rows are written only through allow/revoke RPCs (SECURITY DEFINER).
GRANT SELECT ON public.cash_window_exceptions TO authenticated;

-- 2. Predicate: skip the 9–6 clock when an exception covers this campus today
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
    IF NOT EXISTS (
      SELECT 1 FROM public.cash_window_exceptions e
      WHERE e.allowed_date = v_today
        AND (e.campus_id IS NULL OR e.campus_id = _campus_id)
    ) THEN
      RETURN jsonb_build_object('allowed', false,
        'reason', 'Cash receipts can only be recorded between 9 AM and 6 PM.');
    END IF;
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

-- 3. Grant / revoke — super_admin only, optionally per campus -----------------

CREATE OR REPLACE FUNCTION public.allow_after_hours_cash(
  _campus_ids uuid[] DEFAULT NULL,
  _all boolean DEFAULT false,
  _date date DEFAULT NULL
)
RETURNS TABLE (campus_id uuid, campus_name text, allowed_date date)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
  v_uid   uuid := auth.uid();
  v_pid   uuid := (SELECT id FROM public.profiles WHERE user_id = auth.uid() LIMIT 1);
  v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_date  date := COALESCE(_date, v_today);
  v_cid   uuid;
BEGIN
  IF NOT public.has_role(v_uid, 'super_admin') THEN
    RAISE EXCEPTION 'Only a super_admin can allow after-hours cash';
  END IF;
  IF v_pid IS NULL THEN
    RAISE EXCEPTION 'No staff profile found for the current user';
  END IF;
  IF v_date < v_today THEN
    RAISE EXCEPTION 'Cannot grant after-hours cash for a past date';
  END IF;
  IF v_date > v_today + 30 THEN
    RAISE EXCEPTION 'After-hours cash can only be granted up to 30 days ahead';
  END IF;

  IF _all THEN
    INSERT INTO public.cash_window_exceptions (campus_id, allowed_date, granted_by)
    VALUES (NULL, v_date, v_pid)
    ON CONFLICT (COALESCE(campus_id, '00000000-0000-0000-0000-000000000000'::uuid), allowed_date) DO NOTHING;
  ELSE
    IF _campus_ids IS NULL OR array_length(_campus_ids, 1) IS NULL THEN
      RAISE EXCEPTION 'Select at least one campus, or use allow-all';
    END IF;
    FOREACH v_cid IN ARRAY _campus_ids LOOP
      INSERT INTO public.cash_window_exceptions (campus_id, allowed_date, granted_by)
      VALUES (v_cid, v_date, v_pid)
      ON CONFLICT (COALESCE(campus_id, '00000000-0000-0000-0000-000000000000'::uuid), allowed_date) DO NOTHING;
    END LOOP;
  END IF;

  RETURN QUERY
    SELECT e.campus_id, c.name, e.allowed_date
    FROM public.cash_window_exceptions e
    LEFT JOIN public.campuses c ON c.id = e.campus_id
    WHERE e.allowed_date = v_date;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.allow_after_hours_cash(uuid[], boolean, date) TO authenticated;

CREATE OR REPLACE FUNCTION public.revoke_after_hours_cash(
  _campus_ids uuid[] DEFAULT NULL,
  _all boolean DEFAULT false,
  _date date DEFAULT NULL
)
RETURNS TABLE (campus_id uuid, campus_name text, allowed_date date)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
  v_uid   uuid := auth.uid();
  v_today date := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_date  date := COALESCE(_date, v_today);
  v_cid   uuid;
BEGIN
  IF NOT public.has_role(v_uid, 'super_admin') THEN
    RAISE EXCEPTION 'Only a super_admin can revoke after-hours cash';
  END IF;
  IF v_date < v_today THEN
    RAISE EXCEPTION 'Cannot revoke after-hours cash for a past date';
  END IF;

  IF _all THEN
    -- Turn the date off everywhere, including per-campus grants.
    DELETE FROM public.cash_window_exceptions e
    WHERE e.allowed_date = v_date;
  ELSE
    IF _campus_ids IS NULL OR array_length(_campus_ids, 1) IS NULL THEN
      RAISE EXCEPTION 'Select at least one campus, or use revoke-all';
    END IF;
    FOREACH v_cid IN ARRAY _campus_ids LOOP
      DELETE FROM public.cash_window_exceptions e
      WHERE e.allowed_date = v_date AND e.campus_id = v_cid;
    END LOOP;
  END IF;

  RETURN QUERY
    SELECT e.campus_id, c.name, e.allowed_date
    FROM public.cash_window_exceptions e
    LEFT JOIN public.campuses c ON c.id = e.campus_id
    WHERE e.allowed_date = v_date;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.revoke_after_hours_cash(uuid[], boolean, date) TO authenticated;

-- 4. Read helpers for the Finance header + dialog -----------------------------
CREATE OR REPLACE FUNCTION public.is_after_hours_cash_allowed(
  _campus_id uuid DEFAULT NULL,
  _date date DEFAULT NULL
)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.cash_window_exceptions e
    WHERE e.allowed_date = COALESCE(_date, (now() AT TIME ZONE 'Asia/Kolkata')::date)
      AND (e.campus_id IS NULL OR e.campus_id = _campus_id)
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_after_hours_cash_allowed(uuid, date) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.list_after_hours_cash(_date date DEFAULT NULL)
RETURNS TABLE (campus_id uuid, campus_name text, allowed_date date)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT e.campus_id, c.name, e.allowed_date
  FROM public.cash_window_exceptions e
  LEFT JOIN public.campuses c ON c.id = e.campus_id
  WHERE e.allowed_date = COALESCE(_date, (now() AT TIME ZONE 'Asia/Kolkata')::date)
  ORDER BY c.name NULLS FIRST;
$$;

GRANT EXECUTE ON FUNCTION public.list_after_hours_cash(date) TO authenticated;

NOTIFY pgrst, 'reload schema';
