-- Pin search_path on 10 trigger/utility functions that the advisor flagged
-- as `function_search_path_mutable`. Without an explicit SET, the function
-- inherits the caller's search_path, which lets a malicious caller put a
-- pg_temp shadow object earlier on the path and hijack the function's
-- internal name resolution.
--
-- Each function below has no args (verified via pg_get_function_identity_arguments).
-- ALTER FUNCTION ... SET search_path is non-destructive — it doesn't change
-- function bodies, just attaches a per-call setting.

ALTER FUNCTION public.touch_student_draft_updated_at()     SET search_path = pg_catalog, public;
ALTER FUNCTION public.fn_mirror_school_lead()              SET search_path = pg_catalog, public;
ALTER FUNCTION public.touch_app_doc_review_updated_at()    SET search_path = pg_catalog, public;
ALTER FUNCTION public.touch_lead_draft_updated_at()        SET search_path = pg_catalog, public;
ALTER FUNCTION public.auto_punch_out()                     SET search_path = pg_catalog, public;
ALTER FUNCTION public.normalize_lead_phone()               SET search_path = pg_catalog, public;
ALTER FUNCTION public.update_lead_engagement_on_event()    SET search_path = pg_catalog, public;
ALTER FUNCTION public.tg_offer_waivers_updated_at()        SET search_path = pg_catalog, public;
ALTER FUNCTION public.tg_late_fee_policies_updated_at()    SET search_path = pg_catalog, public;
ALTER FUNCTION public.fn_auto_elevate_priority_interested() SET search_path = pg_catalog, public;
