-- Re-issue the admission number when a document rejection is cleared.
--
-- recompute_lead_fee_stage() blocks AN issuance while lead_has_rejected_doc() is
-- true (latest application_doc_reviews status = 'rejected'), and only runs when a
-- lead_payment changes. So a student who crosses the 25% threshold while a doc is
-- still pending/rejected gets the AN branch RETURNed, and nothing re-fires it once
-- the reviewer later verifies the doc — leaving them pre-admitted forever despite
-- full eligibility (the mahak ansari case + 6 others, 2026-08-07).
--
-- Fix: when an application_doc_review status changes, re-run the stage recompute
-- for its lead. Pre-gated to leads that are pre-admitted but not yet admitted, so
-- the (heavier) recompute never runs for the vast majority of doc reviews on
-- non-admission leads. recompute_lead_fee_stage is idempotent and re-checks the
-- threshold + rejected-doc guard itself, so this only issues an AN when truly due.

CREATE OR REPLACE FUNCTION public.tg_recompute_stage_on_doc_review()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_lead uuid;
BEGIN
  -- Only react to actual status transitions.
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  SELECT a.lead_id INTO v_lead
    FROM public.applications a
   WHERE a.application_id = NEW.application_id
     AND a.lead_id IS NOT NULL
   LIMIT 1;

  IF v_lead IS NULL THEN
    RETURN NEW;
  END IF;

  -- Cheap gate: only bother recomputing for a lead that is pre-admitted and still
  -- waiting on an admission number — the only case a cleared rejection can unblock.
  IF EXISTS (
    SELECT 1 FROM public.students s
     WHERE s.lead_id = v_lead
       AND s.pre_admission_no IS NOT NULL
       AND s.admission_no IS NULL
  ) THEN
    PERFORM public.recompute_lead_fee_stage(v_lead);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_recompute_stage_on_doc_review ON public.application_doc_reviews;
CREATE TRIGGER trg_recompute_stage_on_doc_review
AFTER INSERT OR UPDATE OF status ON public.application_doc_reviews
FOR EACH ROW EXECUTE FUNCTION public.tg_recompute_stage_on_doc_review();
