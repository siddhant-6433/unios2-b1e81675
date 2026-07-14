-- invite-user runs with the service-role client and assigns selected
-- counsellor teams after creating/updating the auth user. The notification
-- grant migration only allowed service_role to read team_members, so the
-- counsellor-team upsert failed through PostgREST with:
--   permission denied for table team_members

GRANT INSERT ON public.team_members TO service_role;
