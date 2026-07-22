-- Receipts should print the institution name derived from the course/class,
-- with the address of that institution's campus — not a campus-pinned branding
-- row. The chain already exists: course → department → institution → campus.
--
--   1. Fill the two missing campus addresses (Avantika & Avantika II) so every
--      course/class on them resolves a real address. All other campuses already
--      have an address; every active course maps to an institution.
--   2. Add lead_letterhead(lead_id): resolves the institution name + campus
--      address for a lead's course. generate-payment-receipt calls this to draw
--      the header. Falls back to the lead's own campus when it has no course.

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
