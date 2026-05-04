-- Service role couldn't DELETE from public.applications via PostgREST —
-- the table's GRANTs covered SELECT/INSERT/UPDATE only. Surfaced when
-- cleaning up test seed data.
--
-- Granting full DML to service_role keeps it consistent with the other
-- admin-flow tables that received the same fix in 20260604190000 /
-- 20260604200000 / 20260604210000.

GRANT SELECT, INSERT, UPDATE, DELETE ON public.applications TO service_role;
