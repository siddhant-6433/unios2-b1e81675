-- Let a counsellor assign a calling list to THEMSELVES.
--
-- A counsellor can already create/edit lead lists (can_manage_lead_lists), but
-- assign_lead_list_round_robin hard-blocked anyone who is neither an admin nor a
-- team leader — so a counsellor could build a list for their own calling and had
-- no way to put it on their own dialer. These self-made lists stay visible to
-- super_admin / principal / admission_head via existing lead_lists RLS.
--
-- This is a permission WIDENING, not a tightening: the `valid` CTE inside the
-- function already restricts a non-admin, non-team-leader caller to counsellor
-- ids that resolve to their own profile (`p.id = v_caller_profile_id`), and the
-- count-mismatch guard raises if they request anyone else. So allowing the
-- `counsellor` role past the top gate only ever lets them assign self.
--
-- Patched against the live prosrc (same convention as 20260802131652) rather than
-- restating the ~250-line body, which is how the two copies drift.

DO $do$
DECLARE src text;
BEGIN
  SELECT prosrc INTO src FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'assign_lead_list_round_robin'
   LIMIT 1;
  IF src IS NULL THEN RETURN; END IF;

  IF position('v_is_team_leader OR public.has_role(v_caller_user_id, ''counsellor''' in src) = 0 THEN
    src := replace(src,
      'IF NOT (v_is_admin OR v_is_team_leader) THEN',
      'IF NOT (v_is_admin OR v_is_team_leader OR public.has_role(v_caller_user_id, ''counsellor''::public.app_role)) THEN');
  END IF;

  EXECUTE format($fmt$
    CREATE OR REPLACE FUNCTION public.assign_lead_list_round_robin(
      _list_id uuid,
      _counsellor_ids uuid[],
      _only_unassigned boolean DEFAULT false,
      _priority_note text DEFAULT NULL,
      _due_date date DEFAULT NULL,
      _include_terminal boolean DEFAULT false
    )
    RETURNS TABLE (
      batch_id uuid, counsellor_id uuid, counsellor_name text,
      assigned_count integer, failed_count integer
    )
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS %L
  $fmt$, src);
END $do$;

REVOKE ALL ON FUNCTION public.assign_lead_list_round_robin(uuid, uuid[], boolean, text, date, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.assign_lead_list_round_robin(uuid, uuid[], boolean, text, date, boolean) TO authenticated;
