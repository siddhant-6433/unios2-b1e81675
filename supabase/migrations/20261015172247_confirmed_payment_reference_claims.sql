-- Reserve each confirmed payment reference in one shared, transactional key
-- space. A primary key lock closes the check-then-insert race across the two
-- payment tables. Claims intentionally have no FK and are not released: a
-- reference remains associated with the payment that first recorded it.
CREATE TABLE public.confirmed_payment_reference_claims (
  reference text PRIMARY KEY CHECK (reference <> '' AND reference = btrim(reference)),
  payment_source text NOT NULL CHECK (payment_source IN ('lead', 'student')),
  payment_id uuid NOT NULL,
  claimed_at timestamptz NOT NULL DEFAULT now()
);

REVOKE ALL ON TABLE public.confirmed_payment_reference_claims FROM PUBLIC, anon, authenticated, service_role;
ALTER TABLE public.confirmed_payment_reference_claims ENABLE ROW LEVEL SECURITY;

WITH all_references AS (
  SELECT NULLIF(btrim(p.transaction_ref), '') AS reference,
         'student'::text AS payment_source,
         p.id AS payment_id,
         p.paid_at AS claimed_at
    FROM public.payments p
   WHERE NULLIF(btrim(p.transaction_ref), '') IS NOT NULL
  UNION ALL
  SELECT NULLIF(btrim(lp.transaction_ref), ''),
         'lead'::text,
         lp.id,
         COALESCE(lp.payment_date, lp.created_at)
    FROM public.lead_payments lp
   WHERE lp.status = 'confirmed'
     AND NULLIF(btrim(lp.transaction_ref), '') IS NOT NULL
  UNION ALL
  SELECT NULLIF(btrim(lp.bank_ref_num), ''),
         'lead'::text,
         lp.id,
         COALESCE(lp.payment_date, lp.created_at)
    FROM public.lead_payments lp
   WHERE lp.status = 'confirmed'
     AND NULLIF(btrim(lp.bank_ref_num), '') IS NOT NULL
), chosen_owner AS (
  -- Existing duplicate history is preserved. Pick a stable owner so new
  -- attempts cannot add another confirmed payment with that reference.
  SELECT DISTINCT ON (reference)
         reference, payment_source, payment_id, claimed_at
    FROM all_references
   WHERE reference IS NOT NULL
   ORDER BY reference, claimed_at NULLS LAST, payment_source, payment_id
)
INSERT INTO public.confirmed_payment_reference_claims (reference, payment_source, payment_id, claimed_at)
SELECT reference, payment_source, payment_id, COALESCE(claimed_at, now())
  FROM chosen_owner;

CREATE OR REPLACE FUNCTION public.claim_confirmed_payment_references()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_references text[];
  v_reference text;
  v_claimed text;
  v_source text := CASE WHEN TG_TABLE_NAME = 'lead_payments' THEN 'lead' ELSE 'student' END;
BEGIN
  IF TG_TABLE_NAME = 'lead_payments' THEN
    IF NEW.status IS DISTINCT FROM 'confirmed' THEN
      RETURN NEW;
    END IF;

    -- Skip ordinary edits to already-confirmed rows. If a reference changes,
    -- or a pending row becomes confirmed, claim all current references.
    IF TG_OP = 'UPDATE'
       AND OLD.status = 'confirmed'
       AND NEW.transaction_ref IS NOT DISTINCT FROM OLD.transaction_ref
       AND NEW.bank_ref_num IS NOT DISTINCT FROM OLD.bank_ref_num THEN
      RETURN NEW;
    END IF;

    SELECT ARRAY(
      SELECT DISTINCT NULLIF(btrim(candidate.reference), '')
        FROM unnest(ARRAY[NEW.transaction_ref, NEW.bank_ref_num]) AS candidate(reference)
       WHERE NULLIF(btrim(candidate.reference), '') IS NOT NULL
       ORDER BY 1
    ) INTO v_references;
  ELSE
    IF TG_OP = 'UPDATE'
       AND NEW.transaction_ref IS NOT DISTINCT FROM OLD.transaction_ref THEN
      RETURN NEW;
    END IF;

    SELECT ARRAY(
      SELECT DISTINCT NULLIF(btrim(candidate.reference), '')
        FROM unnest(ARRAY[NEW.transaction_ref]) AS candidate(reference)
       WHERE NULLIF(btrim(candidate.reference), '') IS NOT NULL
       ORDER BY 1
    ) INTO v_references;
  END IF;

  FOREACH v_reference IN ARRAY COALESCE(v_references, ARRAY[]::text[]) LOOP
    v_claimed := NULL;
    INSERT INTO public.confirmed_payment_reference_claims AS existing
      (reference, payment_source, payment_id)
    VALUES (v_reference, v_source, NEW.id)
    ON CONFLICT (reference) DO UPDATE
      SET claimed_at = existing.claimed_at
      WHERE existing.payment_source = EXCLUDED.payment_source
        AND existing.payment_id = EXCLUDED.payment_id
    RETURNING reference INTO v_claimed;

    IF v_claimed IS NULL THEN
      RAISE EXCEPTION 'Payment reference is already claimed (confirmed_payment_reference_claims_pkey)'
        USING ERRCODE = '23505', CONSTRAINT = 'confirmed_payment_reference_claims_pkey';
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_confirmed_payment_references() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER zzzz_claim_confirmed_lead_payment_reference
  BEFORE INSERT OR UPDATE OF transaction_ref, bank_ref_num, status
  ON public.lead_payments
  FOR EACH ROW EXECUTE FUNCTION public.claim_confirmed_payment_references();

CREATE TRIGGER zzzz_claim_confirmed_student_payment_reference
  BEFORE INSERT OR UPDATE OF transaction_ref
  ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.claim_confirmed_payment_references();

-- Return the same limited identity details for either source. Student identity
-- is inferred from a lead only when exactly one student is attached to it.
CREATE OR REPLACE FUNCTION public.lookup_confirmed_payment_reference(_reference text)
RETURNS TABLE (
  receipt_no text,
  candidate_name text,
  admission_no text,
  course_name text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_reference text := NULLIF(BTRIM(_reference), '');
BEGIN
  IF auth.uid() IS NULL OR NOT (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'accountant') OR
    public.has_role(auth.uid(), 'office_admin')
  ) THEN
    RAISE EXCEPTION 'Not authorised';
  END IF;

  IF v_reference IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH payment_matches AS (
    SELECT lp.receipt_no,
           COALESCE(NULLIF(BTRIM(s.name), ''), NULLIF(BTRIM(l.name), ''), NULLIF(BTRIM(a.full_name), '')) AS candidate_name,
           COALESCE(NULLIF(BTRIM(s.admission_no), ''), NULLIF(BTRIM(l.admission_no), ''),
                    NULLIF(BTRIM(s.pre_admission_no), ''), NULLIF(BTRIM(l.pre_admission_no), '')) AS admission_no,
           COALESCE(app_course.course_name, course.name) AS course_name,
           lp.created_at,
           'lead'::text AS payment_source
      FROM public.lead_payments lp
      LEFT JOIN public.leads l ON l.id = lp.lead_id
      LEFT JOIN LATERAL (
        SELECT st.*
          FROM public.students st
         WHERE st.id = lp.student_id
            OR (lp.student_id IS NULL
                AND st.lead_id = lp.lead_id
                AND NOT EXISTS (
                  SELECT 1 FROM public.students other_student
                   WHERE other_student.lead_id = lp.lead_id
                     AND other_student.id <> st.id
                ))
         LIMIT 1
      ) s ON true
      LEFT JOIN public.courses course ON course.id = s.course_id
      LEFT JOIN LATERAL (
        SELECT ap.*
          FROM public.applications ap
         WHERE (NULLIF(BTRIM(lp.application_id), '') IS NOT NULL
                AND ap.application_id = NULLIF(BTRIM(lp.application_id), ''))
            OR (NULLIF(BTRIM(lp.application_id), '') IS NULL
                AND ap.lead_id = lp.lead_id)
         ORDER BY (ap.application_id = NULLIF(BTRIM(lp.application_id), '')) DESC NULLS LAST,
                  ap.updated_at DESC
         LIMIT 1
      ) a ON true
      LEFT JOIN LATERAL (
        SELECT COALESCE(NULLIF(BTRIM(selection.item->>'course_name'), ''), selected_course.name) AS course_name
          FROM jsonb_array_elements(
                 CASE WHEN jsonb_typeof(a.course_selections) = 'array'
                      THEN a.course_selections ELSE '[]'::jsonb END
               ) WITH ORDINALITY AS selection(item, ordinal)
          LEFT JOIN public.courses selected_course
            ON selected_course.id = CASE
              WHEN NULLIF(selection.item->>'course_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
              THEN (selection.item->>'course_id')::uuid
            END
         WHERE NULLIF(BTRIM(selection.item->>'course_name'), '') IS NOT NULL
            OR selected_course.name IS NOT NULL
         ORDER BY selection.ordinal
         LIMIT 1
      ) app_course ON true
     WHERE lp.status = 'confirmed'
       AND (NULLIF(BTRIM(lp.transaction_ref), '') = v_reference
            OR NULLIF(BTRIM(lp.bank_ref_num), '') = v_reference)

    UNION ALL

    SELECT p.receipt_no,
           NULLIF(BTRIM(s.name), ''),
           COALESCE(NULLIF(BTRIM(s.admission_no), ''), NULLIF(BTRIM(s.pre_admission_no), '')),
           course.name,
           p.created_at,
           'student'::text
      FROM public.payments p
      JOIN public.students s ON s.id = p.student_id
      LEFT JOIN public.courses course ON course.id = s.course_id
     WHERE NULLIF(BTRIM(p.transaction_ref), '') = v_reference
  )
  SELECT matched.receipt_no, matched.candidate_name, matched.admission_no, matched.course_name
    FROM payment_matches matched
   ORDER BY matched.created_at DESC NULLS LAST, matched.payment_source, matched.receipt_no
   LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION public.lookup_confirmed_payment_reference(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lookup_confirmed_payment_reference(text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
