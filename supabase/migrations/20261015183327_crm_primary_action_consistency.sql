-- keep-migration-version: already recorded on production schema_migrations
-- crm primary action consistency

-- Legacy and provider-triggered writers also participate in primary-action
-- ownership. Serialize inserts per lead; the partial unique index remains the
-- final database invariant.
CREATE OR REPLACE FUNCTION public.assign_primary_on_followup_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status <> 'pending' THEN
    NEW.is_primary := false;
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.lead_id::text, 0));
  IF NEW.is_primary THEN RETURN NEW; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.lead_followups lf
    WHERE lf.lead_id = NEW.lead_id AND lf.status = 'pending' AND lf.is_primary
  ) THEN
    NEW.is_primary := true;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.assign_primary_on_followup_insert() FROM PUBLIC;
DROP TRIGGER IF EXISTS trg_assign_primary_on_followup_insert ON public.lead_followups;
CREATE TRIGGER trg_assign_primary_on_followup_insert
  BEFORE INSERT ON public.lead_followups
  FOR EACH ROW EXECUTE FUNCTION public.assign_primary_on_followup_insert();

CREATE OR REPLACE FUNCTION public.promote_next_primary_followup_after_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  v_next_id uuid;
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN NULL; END IF;

  FOR r IN
    SELECT DISTINCT o.lead_id
    FROM old_followups o
    JOIN new_followups n ON n.id = o.id
    WHERE o.status = 'pending' AND o.is_primary
      AND (n.status <> 'pending' OR NOT n.is_primary)
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(r.lead_id::text, 0));
    IF NOT EXISTS (
      SELECT 1 FROM public.lead_followups lf
      WHERE lf.lead_id = r.lead_id AND lf.status = 'pending' AND lf.is_primary
    ) THEN
      SELECT lf.id INTO v_next_id FROM public.lead_followups lf
      WHERE lf.lead_id = r.lead_id AND lf.status = 'pending'
      ORDER BY lf.scheduled_at, lf.created_at, lf.id LIMIT 1;
      IF v_next_id IS NOT NULL THEN
        UPDATE public.lead_followups SET is_primary = true WHERE id = v_next_id;
      END IF;
    END IF;
    v_next_id := NULL;
  END LOOP;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.promote_next_primary_followup_after_update() FROM PUBLIC;
DROP TRIGGER IF EXISTS trg_promote_next_primary_followup_after_update ON public.lead_followups;
CREATE TRIGGER trg_promote_next_primary_followup_after_update
  AFTER UPDATE ON public.lead_followups
  REFERENCING OLD TABLE AS old_followups NEW TABLE AS new_followups
  FOR EACH STATEMENT EXECUTE FUNCTION public.promote_next_primary_followup_after_update();

CREATE OR REPLACE FUNCTION public.promote_next_primary_followup_after_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  v_next_id uuid;
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN NULL; END IF;

  FOR r IN SELECT DISTINCT lead_id FROM deleted_followups WHERE status = 'pending' AND is_primary
  LOOP
    PERFORM pg_advisory_xact_lock(hashtextextended(r.lead_id::text, 0));
    IF NOT EXISTS (
      SELECT 1 FROM public.lead_followups lf
      WHERE lf.lead_id = r.lead_id AND lf.status = 'pending' AND lf.is_primary
    ) THEN
      SELECT lf.id INTO v_next_id FROM public.lead_followups lf
      WHERE lf.lead_id = r.lead_id AND lf.status = 'pending'
      ORDER BY lf.scheduled_at, lf.created_at, lf.id LIMIT 1;
      IF v_next_id IS NOT NULL THEN
        UPDATE public.lead_followups SET is_primary = true WHERE id = v_next_id;
      END IF;
    END IF;
    v_next_id := NULL;
  END LOOP;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.promote_next_primary_followup_after_delete() FROM PUBLIC;
DROP TRIGGER IF EXISTS trg_promote_next_primary_followup_after_delete ON public.lead_followups;
CREATE TRIGGER trg_promote_next_primary_followup_after_delete
  AFTER DELETE ON public.lead_followups
  REFERENCING OLD TABLE AS deleted_followups
  FOR EACH STATEMENT EXECUTE FUNCTION public.promote_next_primary_followup_after_delete();
