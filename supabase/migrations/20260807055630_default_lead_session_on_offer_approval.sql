-- Prevent leads reaching admission intent with a NULL academic session.
--
-- Background: leads.session_id is the key the SQL fee provisioner (and the
-- lead_payments credit trigger) resolve fee_structure by. It is populated only
-- when an offer letter is approved: handle_offer_letter_approval() runs
-- `session_id = COALESCE(session_id, NEW.session_id)`. If the offer itself was
-- created without a session, both sides are NULL and the lead stays sessionless
-- forever — so token payments confirmed later are silently skipped
-- ('missing lead/session/course') and the student is provisioned with no ledger
-- and never gets an admission number. (See the 2026-08-06 incident; the edge
-- provisioner now self-heals the *student* row, but the *lead* remained the gap.)
--
-- Fix: extend the existing COALESCE with a final fallback to the admission
-- session whose [start_date, end_date] covers today. This is purely additive —
-- it only fills a value that would otherwise be NULL, and only when an offer is
-- approved (never touches the ~25k un-converted marketing leads). The date-range
-- rule is deliberate: two sessions can both be is_active=true, and
-- `is_active ORDER BY created_at DESC LIMIT 1` would pick the *future* session
-- (which has no fee_structures). "The session containing today" is the correct,
-- unambiguous current session.

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
  -- Final fallback: the session covering today, so an offer approved without a
  -- session never leaves the lead sessionless (which would strand later token
  -- payments and block provisioning/admission-number issuance).
  UPDATE public.leads
     SET session_id = COALESCE(
           session_id,
           NEW.session_id,
           (SELECT id FROM public.admission_sessions
             WHERE CURRENT_DATE BETWEEN start_date AND end_date
             ORDER BY is_active DESC, start_date DESC
             LIMIT 1)
         )
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
