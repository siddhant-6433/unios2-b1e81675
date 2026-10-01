-- keep-migration-version
-- bind admission eligibility to application id
-- Bind number eligibility to the lead's actual application. Leads can have
-- sibling drafts, so an unrelated latest application must not change the
-- status of the application that the offer and fee workflow are processing.
CREATE OR REPLACE FUNCTION public.lead_admission_issuance_eligible(_lead_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
  SELECT EXISTS (
    SELECT 1
      FROM public.leads l
      JOIN public.applications app
        ON app.lead_id = l.id
       AND app.application_id = l.application_id
     WHERE l.id = _lead_id
       AND app.status IN ('submitted', 'approved')
       AND (app.session_id IS NULL OR app.session_id = l.session_id)
       AND EXISTS (
         SELECT 1
           FROM public.offer_letters ol
          WHERE ol.lead_id = l.id
            AND ol.approval_status = 'approved'
            AND (ol.course_id IS NULL OR ol.course_id = l.course_id)
            AND (ol.session_id IS NULL OR ol.session_id = l.session_id)
       )
  );
$fn$;
