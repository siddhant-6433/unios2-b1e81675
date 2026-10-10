-- keep-migration-version: restored from production schema_migrations.
-- A unique claim row makes application-fee head creation safe even when two
-- fee provisioners begin concurrently and both pass their initial existence
-- check. The deferred FK allows the claim to be reserved in BEFORE INSERT.

CREATE TABLE public.application_fee_head_claims (
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  fee_code_id uuid NOT NULL REFERENCES public.fee_codes(id),
  term text NOT NULL CHECK (term = 'registration'),
  fee_ledger_id uuid NOT NULL UNIQUE
    REFERENCES public.fee_ledger(id) ON DELETE CASCADE
    DEFERRABLE INITIALLY DEFERRED,
  PRIMARY KEY (student_id, fee_code_id, term)
);

ALTER TABLE public.application_fee_head_claims ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.application_fee_head_claims FROM anon, authenticated;

GRANT ALL ON public.application_fee_head_claims TO service_role;

-- Backfill the claim for each canonical application-fee head already in the
-- ledger, after the preceding migration consolidated duplicate heads.
INSERT INTO public.application_fee_head_claims (student_id, fee_code_id, term, fee_ledger_id)
SELECT fl.student_id, fl.fee_code_id, 'registration', fl.id
  FROM public.fee_ledger fl
  JOIN public.fee_codes fc ON fc.id = fl.fee_code_id
 WHERE lower(btrim(fl.term)) = 'registration'
   AND ((fc.code IN ('FORM-FEE','MR-REG','NB-REG')) OR fc.name ILIKE '%application fee%');

CREATE OR REPLACE FUNCTION public.skip_duplicate_application_fee_head()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_is_application_fee boolean;
  v_claimed boolean;
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

  INSERT INTO public.application_fee_head_claims (student_id, fee_code_id, term, fee_ledger_id)
  VALUES (NEW.student_id, NEW.fee_code_id, 'registration', NEW.id)
  ON CONFLICT (student_id, fee_code_id, term) DO NOTHING
  RETURNING true INTO v_claimed;

  IF NOT COALESCE(v_claimed, false) THEN
    RETURN NULL;
  END IF;

  RETURN NEW;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.skip_duplicate_application_fee_head() TO authenticated, service_role;
