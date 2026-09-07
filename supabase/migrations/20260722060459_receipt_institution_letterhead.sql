-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260722060459 name=receipt_institution_letterhead applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

UPDATE public.campuses SET address = 'Ansal Avantika Colony, Shastri Nagar, Ghaziabad 201002' WHERE code = 'GZ2';
UPDATE public.campuses SET address = 'Avantika Extension Colony, Ghaziabad 201002'             WHERE code = 'GZ3';

CREATE OR REPLACE FUNCTION public.lead_letterhead(_lead_id uuid)
RETURNS TABLE(institution_name text, address text, campus_name text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT i.name                                AS institution_name,
         COALESCE(icam.address, lcam.address)  AS address,
         lcam.name                             AS campus_name
    FROM public.leads l
    LEFT JOIN public.campuses    lcam ON lcam.id = l.campus_id
    LEFT JOIN public.courses     co   ON co.id   = l.course_id
    LEFT JOIN public.departments d    ON d.id    = co.department_id
    LEFT JOIN public.institutions i   ON i.id    = d.institution_id
    LEFT JOIN public.campuses    icam ON icam.id = i.campus_id
   WHERE l.id = _lead_id;
$$;

GRANT EXECUTE ON FUNCTION public.lead_letterhead(uuid) TO authenticated, service_role;
