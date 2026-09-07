-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260807063511 name=reissue_an_on_doc_review applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

CREATE OR REPLACE FUNCTION public.tg_recompute_stage_on_doc_review()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_lead uuid;
BEGIN
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
