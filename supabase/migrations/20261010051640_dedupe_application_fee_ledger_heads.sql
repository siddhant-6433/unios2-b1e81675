-- Consolidate duplicate one-time application-fee heads and prevent them from
-- being recreated by either the Edge Function or SQL fee provisioner.

CREATE TABLE public.fee_ledger_duplicate_repairs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  fee_code_id uuid NOT NULL REFERENCES public.fee_codes(id),
  term text NOT NULL,
  canonical_fee_ledger_id uuid NOT NULL,
  removed_fee_ledger_ids uuid[] NOT NULL,
  before_rows jsonb NOT NULL,
  before_paid_amount numeric(12,2) NOT NULL,
  linked_confirmed_amount numeric(12,2) NOT NULL,
  paid_amount_difference numeric(12,2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.fee_ledger_duplicate_repairs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Finance can view application fee duplicate repairs"
  ON public.fee_ledger_duplicate_repairs FOR SELECT TO authenticated USING (
    public.has_role(auth.uid(), 'super_admin') OR
    public.has_role(auth.uid(), 'accountant') OR
    public.has_role(auth.uid(), 'campus_admin') OR
    public.has_role(auth.uid(), 'principal') OR
    public.has_role(auth.uid(), 'vice_principal') OR
    public.has_role(auth.uid(), 'office_admin')
  );
GRANT SELECT ON public.fee_ledger_duplicate_repairs TO authenticated;
GRANT ALL ON public.fee_ledger_duplicate_repairs TO service_role;

-- Pick the earliest row as the stable canonical head. Keep the maximum billed
-- amount and concession rather than summing duplicate charges. Move every
-- payment link before deleting the duplicate rows, then recompute paid_amount
-- from linked confirmed payments, capped at each payment's actual amount.
DO $repair$
DECLARE
  r record;
  v_canonical uuid;
  v_duplicates uuid[];
  v_before_paid numeric;
  v_linked_confirmed numeric;
  v_total numeric;
  v_concession numeric;
  v_rows jsonb;
BEGIN
  FOR r IN
    SELECT fl.student_id, fl.fee_code_id, lower(btrim(fl.term)) AS normalized_term,
           min(fl.term) AS term, count(*) AS row_count
      FROM public.fee_ledger fl
      JOIN public.fee_codes fc ON fc.id = fl.fee_code_id
     WHERE lower(btrim(fl.term)) = 'registration'
       AND ((fc.code IN ('FORM-FEE','MR-REG','NB-REG')) OR fc.name ILIKE '%application fee%')
     GROUP BY fl.student_id, fl.fee_code_id, lower(btrim(fl.term))
    HAVING count(*) > 1
  LOOP
    SELECT (array_agg(fl.id ORDER BY fl.created_at, fl.id))[1],
           (array_agg(fl.id ORDER BY fl.created_at, fl.id))[2:]
      INTO v_canonical, v_duplicates
      FROM public.fee_ledger fl
     WHERE fl.student_id = r.student_id
       AND fl.fee_code_id = r.fee_code_id
       AND lower(btrim(fl.term)) = r.normalized_term;

    SELECT COALESCE(sum(fl.paid_amount), 0),
           COALESCE(max(fl.total_amount), 0),
           COALESCE(max(fl.concession), 0),
           jsonb_agg(to_jsonb(fl) ORDER BY fl.created_at, fl.id)
      INTO v_before_paid, v_total, v_concession, v_rows
      FROM public.fee_ledger fl
     WHERE fl.id = ANY(array_prepend(v_canonical, v_duplicates));

    SELECT COALESCE(sum(LEAST(p.amount, p.linked_amount)), 0)
      INTO v_linked_confirmed
      FROM (
        SELECT lp.id, lp.amount, sum(flp.amount) AS linked_amount
          FROM public.fee_ledger_payments flp
          JOIN public.lead_payments lp ON lp.id = flp.lead_payment_id
         WHERE flp.fee_ledger_id = ANY(array_prepend(v_canonical, v_duplicates))
           AND lp.status = 'confirmed'
           AND lp.type = 'application_fee'
         GROUP BY lp.id, lp.amount
      ) p;

    INSERT INTO public.fee_ledger_duplicate_repairs (
      student_id, fee_code_id, term, canonical_fee_ledger_id,
      removed_fee_ledger_ids, before_rows, before_paid_amount,
      linked_confirmed_amount, paid_amount_difference
    ) VALUES (
      r.student_id, r.fee_code_id, r.term, v_canonical,
      v_duplicates, v_rows, v_before_paid, v_linked_confirmed,
      v_before_paid - v_linked_confirmed
    );

    UPDATE public.fee_ledger_payments
       SET fee_ledger_id = v_canonical
     WHERE fee_ledger_id = ANY(v_duplicates);

    -- Keep any amount mismatch in the repair record for finance review. The
    -- visible head reflects supported receipts and one charge, without silently
    -- treating duplicate/unlinked ledger amounts as confirmed collections.
    v_total := GREATEST(v_total, v_linked_confirmed);
    v_concession := LEAST(v_concession, GREATEST(v_total - v_linked_confirmed, 0));
    UPDATE public.fee_ledger
       SET total_amount = v_total,
           concession = v_concession,
           paid_amount = v_linked_confirmed,
           status = CASE
             WHEN v_linked_confirmed + v_concession >= v_total THEN 'paid'
             WHEN due_date < CURRENT_DATE THEN 'overdue'
             ELSE 'due'
           END,
           updated_at = now()
     WHERE id = v_canonical;

    DELETE FROM public.fee_ledger WHERE id = ANY(v_duplicates);
  END LOOP;
END;
$repair$;

-- Serialize insertion by student/code/registration term. Returning NULL from
-- a BEFORE INSERT trigger skips a duplicate row, which also deduplicates two
-- repeated fee-structure items in the same INSERT statement. Advisory locking
-- closes the race between concurrent provisioning calls.
CREATE OR REPLACE FUNCTION public.skip_duplicate_application_fee_head()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_is_application_fee boolean;
BEGIN
  IF lower(btrim(NEW.term)) <> 'registration' THEN
    RETURN NEW;
  END IF;

  SELECT ((fc.code IN ('FORM-FEE','MR-REG','NB-REG')) OR fc.name ILIKE '%application fee%')
    INTO v_is_application_fee
    FROM public.fee_codes fc
   WHERE fc.id = NEW.fee_code_id;

  IF NOT COALESCE(v_is_application_fee, false) THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    NEW.student_id::text || ':' || NEW.fee_code_id::text || ':' || lower(btrim(NEW.term)), 0
  ));

  IF EXISTS (
    SELECT 1 FROM public.fee_ledger fl
     WHERE fl.student_id = NEW.student_id
       AND fl.fee_code_id = NEW.fee_code_id
       AND lower(btrim(fl.term)) = lower(btrim(NEW.term))
  ) THEN
    RETURN NULL;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_skip_duplicate_application_fee_head ON public.fee_ledger;
CREATE TRIGGER trg_skip_duplicate_application_fee_head
  BEFORE INSERT ON public.fee_ledger
  FOR EACH ROW EXECUTE FUNCTION public.skip_duplicate_application_fee_head();

GRANT EXECUTE ON FUNCTION public.skip_duplicate_application_fee_head() TO authenticated, service_role;
