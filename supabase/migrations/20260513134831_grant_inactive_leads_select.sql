-- Grant SELECT on the inactive_leads view to authenticated users.
--
-- The view was created without a `GRANT SELECT ... TO authenticated` so every
-- PostgREST call from the frontend (e.g. src/components/admissions/
-- InactivityAlertBanner.tsx loaded on /admissions and lead-list pages) was
-- returning 403 'permission denied for view inactive_leads' for every role,
-- including campus_admin and counsellor. The banner silently swallowed the
-- error and never showed inactive-lead counts.
--
-- Mirrors the grant pattern used by adjacent views (overdue_followups,
-- post_visit_pending_followups, whatsapp_conversations).

GRANT SELECT ON public.inactive_leads TO authenticated;
