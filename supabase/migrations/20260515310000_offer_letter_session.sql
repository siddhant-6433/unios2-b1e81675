-- ====================================================================
-- Token Fee Engine — Phase 2
--   1. Add session_id to offer_letters so each offer locks in the
--      academic session whose fee_structure applies.
--   2. Backfill existing offers + leads to the currently-active session
--      so historical data still resolves.
--   3. Trigger: on offer_letters.approval_status -> 'approved', mirror
--      session_id onto leads.session_id and set leads.token_amount to
--      10% of first-year fee.
-- ====================================================================

-- 1. session_id on offer_letters -----------------------------------------
ALTER TABLE public.offer_letters
  ADD COLUMN IF NOT EXISTS session_id uuid REFERENCES public.admission_sessions(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_offer_letters_session ON public.offer_letters(session_id);

-- 2. Backfill: tie historical rows to the active session -----------------
UPDATE public.offer_letters ol
   SET session_id = (SELECT id FROM public.admission_sessions WHERE is_active = true ORDER BY created_at DESC LIMIT 1)
 WHERE ol.session_id IS NULL;

UPDATE public.leads l
   SET session_id = (SELECT id FROM public.admission_sessions WHERE is_active = true ORDER BY created_at DESC LIMIT 1)
 WHERE l.session_id IS NULL
   AND l.stage IN ('offer_sent','token_paid','pre_admitted','admitted');

-- 3. Trigger: on offer approval, propagate session_id + token_amount onto lead
CREATE OR REPLACE FUNCTION public.handle_offer_letter_approval()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_first_year numeric;
  v_token      numeric;
BEGIN
  -- Only act on transitions into 'approved'.
  IF NEW.approval_status IS DISTINCT FROM 'approved' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.approval_status = 'approved' THEN
    RETURN NEW;
  END IF;

  -- Mirror session_id onto the lead so lead_first_year_fee() can resolve.
  UPDATE public.leads
     SET session_id = COALESCE(session_id, NEW.session_id)
   WHERE id = NEW.lead_id;

  -- Compute token_amount = 10% of first-year fee from the locked structure.
  v_first_year := public.lead_first_year_fee(NEW.lead_id);
  v_token      := ROUND(v_first_year * 0.10, 2);

  IF v_token > 0 THEN
    UPDATE public.leads
       SET token_amount = v_token
     WHERE id = NEW.lead_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS offer_letters_on_approval ON public.offer_letters;
CREATE TRIGGER offer_letters_on_approval
AFTER INSERT OR UPDATE OF approval_status ON public.offer_letters
FOR EACH ROW
WHEN (NEW.approval_status = 'approved')
EXECUTE FUNCTION public.handle_offer_letter_approval();

-- 4. Backfill token_amount for existing approved offers.
WITH approved_offers AS (
  SELECT DISTINCT ON (lead_id) lead_id, session_id
    FROM public.offer_letters
   WHERE approval_status = 'approved'
   ORDER BY lead_id, created_at DESC
)
UPDATE public.leads l
   SET token_amount = ROUND(public.lead_first_year_fee(l.id) * 0.10, 2)
  FROM approved_offers ao
 WHERE l.id = ao.lead_id
   AND (l.token_amount IS NULL OR l.token_amount = 0)
   AND public.lead_first_year_fee(l.id) > 0;
