-- Old CRM tabs still call reconcile_stale_live_calls via PostgREST
-- (~2.8k authenticated calls today, 189ms mean). Stale rows are closed by
-- reconcile_stale_live_calls_cron. LiveCallBar already uses a local display
-- cutoff, so authenticated EXECUTE is only a leftover hammer.

REVOKE ALL ON FUNCTION public.reconcile_stale_live_calls(integer) FROM PUBLIC, anon, authenticated;
