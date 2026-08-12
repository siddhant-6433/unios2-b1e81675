-- Two pre-existing bugs in close_day() that made "Close Day" fail on every
-- real close (it had never been exercised with actual receipts until now):
--
--  1. "column reference campus_id is ambiguous" — the function RETURNS
--     TABLE(campus_id, campus_name, closed_date), so campus_id/closed_date
--     exist as OUT variables. The `ON CONFLICT (COALESCE(campus_id, ...),
--     closed_date)` expression referenced those bare names, which collide with
--     the day_closures columns. `#variable_conflict use_column` makes bare
--     names resolve to the table column.
--
--  2. FK violation on closed_by — day_closures.closed_by references
--     profiles(id), but the function stored auth.uid() (which is
--     profiles.user_id, a different uuid). Resolve the profile id first.
CREATE OR REPLACE FUNCTION public.close_day(_campus_ids uuid[] DEFAULT NULL::uuid[], _all boolean DEFAULT false)
 RETURNS TABLE(campus_id uuid, campus_name text, closed_date date)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
  v_uid      uuid    := auth.uid();
  v_pid      uuid    := (SELECT id FROM public.profiles WHERE user_id = auth.uid() LIMIT 1);
  v_today    date    := (now() AT TIME ZONE 'Asia/Kolkata')::date;
  v_is_super boolean := public.has_role(v_uid, 'super_admin');
  v_cid      uuid;
BEGIN
  IF NOT (v_is_super OR public.has_role(v_uid, 'accountant')) THEN
    RAISE EXCEPTION 'Only an accountant or super_admin can close the day';
  END IF;
  IF v_pid IS NULL THEN
    RAISE EXCEPTION 'No staff profile found for the current user';
  END IF;

  IF _all THEN
    IF v_is_super THEN
      INSERT INTO public.day_closures (campus_id, closed_date, closed_by)
      VALUES (NULL, v_today, v_pid)
      ON CONFLICT (COALESCE(campus_id, '00000000-0000-0000-0000-000000000000'::uuid), closed_date) DO NOTHING;
    ELSE
      FOREACH v_cid IN ARRAY COALESCE(public.user_assigned_campus_ids(v_uid), ARRAY[]::uuid[]) LOOP
        INSERT INTO public.day_closures (campus_id, closed_date, closed_by)
        VALUES (v_cid, v_today, v_pid)
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
      VALUES (v_cid, v_today, v_pid)
      ON CONFLICT (COALESCE(campus_id, '00000000-0000-0000-0000-000000000000'::uuid), closed_date) DO NOTHING;
    END LOOP;
  END IF;

  RETURN QUERY
    SELECT dc.campus_id, c.name, dc.closed_date
    FROM public.day_closures dc
    LEFT JOIN public.campuses c ON c.id = dc.campus_id
    WHERE dc.closed_date = v_today AND dc.closed_by = v_pid;
END;
$function$;
