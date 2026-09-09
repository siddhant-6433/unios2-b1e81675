-- The 10pm IST counsellor-score-cron (and visit-closure-cron) use
-- service_role. score_penalty_log / counsellor_score_events were only
-- GRANTed to authenticated, so every nightly penalty attempt logged
-- "permission denied for table …" (~100 errors in one minute on 2026-09-08)
-- and no penalties were recorded.
--
-- service_role is not a member of authenticated, so those grants do not
-- inherit. Views the cron reads had the same authenticated-only hole.

GRANT SELECT, INSERT, UPDATE, DELETE ON public.score_penalty_log TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.counsellor_score_events TO service_role;

GRANT SELECT ON public.post_visit_pending_followups TO service_role;
GRANT SELECT ON public.overdue_followups TO service_role;
