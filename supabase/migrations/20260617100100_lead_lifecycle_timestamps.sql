-- PR1 Visit track — lifecycle timestamps for cohort attribution (PR2 depends).
--
-- leads has no per-stage timestamps. Add applied_at / admitted_at, maintained
-- by a guarded BEFORE UPDATE trigger (fires only on stage change), first-write-
-- wins. Backfill is AUTHORITATIVE, not best-effort, because PR2 cohort
-- attribution keys off these:
--   * the admit event is logged type='conversion' (ConvertToStudentDialog),
--     NOT type='stage_change' — a stage_change-only backfill misses admits.
--   * several stage transitions are DB-side (fee-paid trigger, advance_lead_*)
--     with no activity row — so applied_at falls back to applications.created_at.

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS applied_at   timestamptz,
  ADD COLUMN IF NOT EXISTS admitted_at  timestamptz;

COMMENT ON COLUMN public.leads.applied_at IS
  'First time the lead entered an application stage (Applied bucket or beyond). First-write-wins, maintained by trg_stamp_lead_lifecycle. Used for visit/call cohort attribution.';
COMMENT ON COLUMN public.leads.admitted_at IS
  'First time the lead reached admitted. First-write-wins.';

-- Stages that count as "has applied" (Applied bucket or anything past it).
-- Centralised here as the trigger + backfill must agree.
CREATE OR REPLACE FUNCTION public.fn_stamp_lead_lifecycle()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  applied_stages text[] := ARRAY[
    'application_in_progress','application_submitted','application_fee_paid',
    'application_approved','interview','offer_sent','token_paid',
    'pre_admitted','admitted','waitlisted'
  ];
BEGIN
  IF NEW.applied_at IS NULL AND NEW.stage::text = ANY(applied_stages) THEN
    NEW.applied_at := now();
  END IF;
  IF NEW.admitted_at IS NULL AND NEW.stage::text = 'admitted' THEN
    NEW.admitted_at := now();
  END IF;
  RETURN NEW;
END;
$$;

-- WHEN guard: only run on an actual stage change, not on every lead update
-- (leads is hot — last_engaged_at etc. churn it constantly).
DROP TRIGGER IF EXISTS trg_stamp_lead_lifecycle ON public.leads;
CREATE TRIGGER trg_stamp_lead_lifecycle
  BEFORE UPDATE ON public.leads
  FOR EACH ROW
  WHEN (OLD.stage IS DISTINCT FROM NEW.stage)
  EXECUTE FUNCTION public.fn_stamp_lead_lifecycle();

-- ── Authoritative backfill ──────────────────────────────────────────────────
-- applied_at = earliest of: any stage_change/conversion activity INTO an
-- applied-or-beyond stage, OR the lead's earliest linked application.
WITH applied_evt AS (
  SELECT la.lead_id, MIN(la.created_at) AS ts
    FROM public.lead_activities la
   WHERE la.type IN ('stage_change','conversion')
     AND la.new_stage::text IN (
       'application_in_progress','application_submitted','application_fee_paid',
       'application_approved','interview','offer_sent','token_paid',
       'pre_admitted','admitted','waitlisted')
   GROUP BY la.lead_id
),
applied_app AS (
  SELECT a.lead_id, MIN(a.created_at) AS ts
    FROM public.applications a
   GROUP BY a.lead_id
)
UPDATE public.leads l
   SET applied_at = LEAST(
         COALESCE(e.ts, a.ts),
         COALESCE(a.ts, e.ts)
       )
  FROM applied_evt e
  FULL OUTER JOIN applied_app a ON a.lead_id = e.lead_id
 WHERE l.id = COALESCE(e.lead_id, a.lead_id)
   AND l.applied_at IS NULL
   AND COALESCE(e.ts, a.ts) IS NOT NULL;

-- admitted_at = earliest stage_change/conversion activity INTO admitted.
WITH admitted_evt AS (
  SELECT la.lead_id, MIN(la.created_at) AS ts
    FROM public.lead_activities la
   WHERE la.type IN ('stage_change','conversion')
     AND la.new_stage::text = 'admitted'
   GROUP BY la.lead_id
)
UPDATE public.leads l
   SET admitted_at = ev.ts
  FROM admitted_evt ev
 WHERE l.id = ev.lead_id
   AND l.admitted_at IS NULL;

-- Final safety net: any lead currently AT admitted with no admitted_at (no
-- activity row at all) gets stamped from its last update.
UPDATE public.leads
   SET admitted_at = COALESCE(admitted_at, updated_at, now())
 WHERE stage = 'admitted' AND admitted_at IS NULL;
