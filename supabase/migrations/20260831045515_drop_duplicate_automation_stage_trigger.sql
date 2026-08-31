-- Drop the redundant "combined" automation trigger on leads.
--
-- `leads` had TWO overlapping automation paths on UPDATE:
--   * trg_automation_on_stage_change  -> fn_automation_on_stage_change   (x-cron-secret, works)
--   * trg_automation_on_lead_assigned -> fn_automation_on_lead_assigned  (x-cron-secret, works)
--   * trg_automation_stage_change     -> fn_trigger_automation_on_stage_change
--         (Authorization: Bearer <service_role_key>, i.e. the legacy JWT path)
--
-- The combined fn_trigger_automation_on_stage_change fired automation-engine for
-- BOTH stage_change and lead_assigned in one trigger. It was silently 401'ing
-- because it authenticates with the opaque sb_secret_ service key against
-- automation-engine's JWT check. Now that automation-engine accepts
-- isServiceCaller() (drift-immune), that call would START succeeding — causing
-- automation-engine to be invoked TWICE per stage change (once here, once via
-- the granular working triggers). The granular triggers on_stage_change /
-- on_lead_assigned / on_lead_created already cover every case, so this combined
-- trigger is fully redundant. Drop it (and its function) to prevent the
-- double-invocation.

DROP TRIGGER IF EXISTS trg_automation_stage_change ON public.leads;
DROP FUNCTION IF EXISTS public.fn_trigger_automation_on_stage_change();
