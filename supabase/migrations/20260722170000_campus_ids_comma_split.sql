-- user_assigned_campus_ids: handle comma-separated profiles.campus values
-- Previously compared the whole string against campus names, which failed
-- when multiple campuses were assigned (e.g. "Campus A, Campus B").
CREATE OR REPLACE FUNCTION public.user_assigned_campus_ids(_user_id uuid)
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(array_agg(c.id), ARRAY[]::uuid[])
  FROM public.profiles p
  CROSS JOIN LATERAL unnest(string_to_array(p.campus, ',')) AS part(raw)
  JOIN public.campuses c
    ON lower(c.name) = lower(btrim(part.raw))
    OR lower(c.code) = lower(btrim(part.raw))
  WHERE p.user_id = _user_id
    AND p.campus IS NOT NULL
    AND btrim(p.campus) <> '';
$$;
