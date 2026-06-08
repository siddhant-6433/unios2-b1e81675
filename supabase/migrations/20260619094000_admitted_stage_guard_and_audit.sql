-- Admitted-stage integrity + centralized stage audit.
--
-- Root cause: several app / edge-function paths can update leads.stage
-- directly. If a lead already has an Admission Number (AN), moving it to
-- not_interested / rejected / etc. makes dashboard counts disagree with the
-- lifecycle and, when the caller does not also insert lead_activities, leaves
-- no Activity-tab audit trail.

-- 1. Repair existing inconsistent rows before installing the guard.
WITH to_repair AS (
  SELECT id, stage AS old_stage
    FROM public.leads
   WHERE admission_no IS NOT NULL
     AND stage IS DISTINCT FROM 'admitted'::public.lead_stage
),
repaired AS (
  UPDATE public.leads l
     SET stage = 'admitted'::public.lead_stage
    FROM to_repair r
   WHERE l.id = r.id
   RETURNING l.id, r.old_stage, l.stage AS new_stage
)
INSERT INTO public.lead_activities (lead_id, type, description, old_stage, new_stage)
SELECT
  id,
  'stage_change',
  'Stage repaired by admitted-stage guard: AN exists, so lead restored to Admitted',
  old_stage,
  new_stage
FROM repaired;

-- 2. Guard: once admission_no exists, the lead must remain admitted unless an
-- explicit admission-reversal workflow clears admission_no in the same update.
CREATE OR REPLACE FUNCTION public.fn_guard_admitted_lead_stage()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.admission_no IS NOT NULL
     AND NEW.stage IS DISTINCT FROM 'admitted'::public.lead_stage THEN
    RAISE EXCEPTION
      'cannot set lead % with admission_no % to stage %',
      NEW.id, NEW.admission_no, NEW.stage
      USING
        ERRCODE = '23514',
        HINT = 'Use an explicit admission reversal workflow that clears admission_no before moving the lead out of admitted.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_admitted_lead_stage ON public.leads;
CREATE TRIGGER trg_guard_admitted_lead_stage
  BEFORE INSERT OR UPDATE OF admission_no, stage ON public.leads
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_guard_admitted_lead_stage();

-- 3. Central audit: every accepted stage transition gets a lead_activities
-- row, no matter which client/function/RPC changed the stage.
CREATE OR REPLACE FUNCTION public.fn_audit_lead_stage_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.lead_activities (lead_id, type, description, old_stage, new_stage)
  SELECT
    NEW.id,
    'stage_change',
    'Stage changed from ' || COALESCE(OLD.stage::text, 'unknown') ||
      ' to ' || COALESCE(NEW.stage::text, 'unknown') || ' (database audit)',
    OLD.stage,
    NEW.stage
  WHERE NOT EXISTS (
    SELECT 1
      FROM public.lead_activities la
     WHERE la.lead_id = NEW.id
       AND la.type = 'stage_change'
       AND la.old_stage IS NOT DISTINCT FROM OLD.stage
       AND la.new_stage IS NOT DISTINCT FROM NEW.stage
       AND la.created_at >= statement_timestamp() - interval '5 seconds'
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_lead_stage_change ON public.leads;
CREATE TRIGGER trg_audit_lead_stage_change
  AFTER UPDATE OF stage ON public.leads
  FOR EACH ROW
  WHEN (OLD.stage IS DISTINCT FROM NEW.stage)
  EXECUTE FUNCTION public.fn_audit_lead_stage_change();

COMMENT ON FUNCTION public.fn_guard_admitted_lead_stage() IS
  'Prevents leads with admission_no from drifting out of stage=admitted. Clear admission_no via an explicit reversal workflow first.';

COMMENT ON FUNCTION public.fn_audit_lead_stage_change() IS
  'Database-level stage-change audit into lead_activities so direct lead.stage updates cannot disappear from the Activity tab.';
