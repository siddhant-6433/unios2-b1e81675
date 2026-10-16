-- keep-migration-version: already recorded on production schema_migrations
-- crm score refresh triggers

-- Keep the existing lead score and temperature in sync with lifecycle and
-- engagement changes. The previous BEFORE UPDATE trigger queried leads by id,
-- so it saw the persisted OLD values; activity inserts did not refresh scores.

-- Scoring reads rows changed by the current transaction, so it must take a
-- fresh snapshot when called from an AFTER trigger.
ALTER FUNCTION public.compute_lead_score(uuid) VOLATILE;

CREATE OR REPLACE FUNCTION public.refresh_lead_score(p_lead_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_score integer;
  v_temperature text;
BEGIN
  v_score := public.compute_lead_score(p_lead_id);
  v_temperature := public.compute_lead_temperature(v_score);

  UPDATE public.leads
  SET lead_score = v_score,
      lead_temperature = v_temperature
  WHERE id = p_lead_id
    AND (lead_score IS DISTINCT FROM v_score
      OR lead_temperature IS DISTINCT FROM v_temperature);
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_lead_score(uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.trigger_update_lead_score()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.refresh_lead_score(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_lead_score_update ON public.leads;
CREATE TRIGGER trg_lead_score_update
  AFTER UPDATE OF stage, source, interview_score, updated_at
  ON public.leads
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_update_lead_score();

DROP TRIGGER IF EXISTS trg_lead_score_insert ON public.leads;
CREATE TRIGGER trg_lead_score_insert
  AFTER INSERT
  ON public.leads
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_update_lead_score();

CREATE OR REPLACE FUNCTION public.trigger_refresh_lead_score_from_activity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.refresh_lead_score(OLD.lead_id);
    RETURN OLD;
  END IF;

  PERFORM public.refresh_lead_score(NEW.lead_id);
  IF TG_OP = 'UPDATE' AND OLD.lead_id IS DISTINCT FROM NEW.lead_id THEN
    PERFORM public.refresh_lead_score(OLD.lead_id);
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.trigger_update_lead_score() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.trigger_refresh_lead_score_from_activity() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_lead_score_activity_refresh ON public.lead_activities;
CREATE TRIGGER trg_lead_score_activity_refresh
  AFTER INSERT OR UPDATE OR DELETE
  ON public.lead_activities
  FOR EACH ROW
  EXECUTE FUNCTION public.trigger_refresh_lead_score_from_activity();
