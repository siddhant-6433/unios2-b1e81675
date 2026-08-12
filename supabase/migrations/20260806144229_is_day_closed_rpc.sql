-- Read-only check so the Finance header can show "Day Closed" after a close.
-- day_closures has RLS with no SELECT policy (client can't read it directly),
-- so expose a SECURITY DEFINER boolean that mirrors the day_closures check
-- inside can_create_cash_receipt(): closed for this scope if a global closure
-- (campus_id IS NULL) or a closure for the given campus exists for today.
CREATE OR REPLACE FUNCTION public.is_day_closed(_campus_id uuid DEFAULT NULL)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.day_closures dc
    WHERE dc.closed_date = (now() AT TIME ZONE 'Asia/Kolkata')::date
      AND (dc.campus_id IS NULL OR dc.campus_id = _campus_id)
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_day_closed(uuid) TO authenticated, service_role;
