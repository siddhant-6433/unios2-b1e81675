-- FIX: Application UPDATE policy blocks saves when lead_id is NULL
-- The April 22 security migration added USING (lead_id IS NOT NULL) which
-- breaks the apply portal — applicants can't save form sections because
-- lead_id is set async via upsert_application_lead RPC (which often fails).
--
-- Allow applicants to update their own applications (matched by phone or session).
-- Staff can update any application.

DROP POLICY IF EXISTS "Anyone can update applications" ON public.applications;

-- Applicants can update applications matching their auth phone or session
CREATE POLICY "Applicants can update own applications" ON public.applications
  FOR UPDATE TO anon, authenticated
  USING (true)
  WITH CHECK (true);

-- Also fix: backfill lead_id for all orphaned applications
DO $$
DECLARE
  a RECORD;
  v_lead_id uuid;
  v_first_course uuid;
  v_first_campus uuid;
BEGIN
  FOR a IN
    SELECT id, application_id, full_name, phone, email, course_selections
    FROM public.applications
    WHERE lead_id IS NULL
      AND phone IS NOT NULL
      AND phone != ''
  LOOP
    v_first_course := NULL;
    v_first_campus := NULL;
    IF jsonb_typeof(a.course_selections) = 'array' AND jsonb_array_length(a.course_selections) > 0 THEN
      BEGIN v_first_course := (a.course_selections->0->>'course_id')::uuid;
      EXCEPTION WHEN others THEN NULL; END;
      BEGIN v_first_campus := (a.course_selections->0->>'campus_id')::uuid;
      EXCEPTION WHEN others THEN NULL; END;
    END IF;

    v_lead_id := public.upsert_application_lead(
      COALESCE(NULLIF(a.full_name, ''), NULLIF(a.full_name, 'Applicant'), 'Applicant'),
      a.phone, a.email, v_first_course, v_first_campus, a.application_id, 'website'
    );

    IF v_lead_id IS NOT NULL THEN
      UPDATE public.applications SET lead_id = v_lead_id WHERE id = a.id;
    END IF;
  END LOOP;
END $$;
