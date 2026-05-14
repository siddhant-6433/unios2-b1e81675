-- One-shot remediation: re-route leads currently sitting with a counsellor
-- who isn't in any of the teams that fn_teams_for_lead returns.
--
-- Cause: the previous fn_round_robin_assign_counsellor + ai-call-failed-handler
-- ignored team scoping, so Law/Mgmt/BEd/Mirai/School leads were spread across
-- counsellors regardless of vertical. System-wide ~6k active leads were on
-- the wrong counsellor.
--
-- Runs after 20260610030000_multi_team_routing.sql so fn_teams_for_lead exists.
--
-- Strategy:
--   • Only touch active funnel stages where re-routing is safe:
--     new_lead, counsellor_call, priority_interested, ai_called.
--   • Skip leads with an in-flight visit or application (don't yank work).
--   • Skip if every target team (and Grn Counselling) is empty — leave the
--     lead where it is rather than orphan it.
--   • Null out counsellor_id, then call fn_round_robin_assign_counsellor to
--     pick fresh. Log each move in lead_activities.

DO $$
DECLARE
  r        RECORD;
  v_old    uuid;
  v_new    uuid;
  v_teams  text[];
  v_moved  int := 0;
  v_skip   int := 0;
BEGIN
  FOR r IN
    SELECT l.id           AS lead_id,
           l.counsellor_id AS current_counsellor,
           p.user_id       AS current_user_id
    FROM public.leads l
    JOIN public.profiles p ON p.id = l.counsellor_id
    WHERE l.counsellor_id IS NOT NULL
      AND l.stage::text IN ('new_lead','counsellor_call','priority_interested','ai_called')
      AND NOT EXISTS (
        SELECT 1 FROM public.campus_visits v
        WHERE v.lead_id = l.id AND v.status = 'scheduled'
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.applications a WHERE a.lead_id = l.id
      )
  LOOP
    v_teams := public.fn_teams_for_lead(r.lead_id);

    -- If the current counsellor is in any of the correct teams, leave alone.
    IF EXISTS (
      SELECT 1
      FROM public.teams t
      JOIN public.team_members tm ON tm.team_id = t.id
      WHERE t.name = ANY(v_teams) AND tm.user_id = r.current_user_id
    ) THEN
      CONTINUE;
    END IF;

    -- Skip if no target team (incl. Grn Counselling fallback) has members.
    IF NOT EXISTS (
      SELECT 1 FROM public.teams t
      JOIN public.team_members tm ON tm.team_id = t.id
      WHERE t.name = ANY(v_teams) OR t.name = 'Grn Counselling'
    ) THEN
      v_skip := v_skip + 1;
      CONTINUE;
    END IF;

    v_old := r.current_counsellor;

    UPDATE public.leads
       SET counsellor_id = NULL,
           updated_at    = now()
     WHERE id = r.lead_id;

    v_new := public.fn_round_robin_assign_counsellor(r.lead_id);

    IF v_new IS NULL THEN
      UPDATE public.leads
         SET counsellor_id = v_old,
             updated_at    = now()
       WHERE id = r.lead_id;
      v_skip := v_skip + 1;
      CONTINUE;
    END IF;

    IF v_new <> v_old THEN
      INSERT INTO public.lead_activities (lead_id, type, description)
      VALUES (
        r.lead_id, 'system',
        format('Re-routed to correct team(s): %s — previous assignment ignored vertical.',
               array_to_string(v_teams, ', '))
      );
      v_moved := v_moved + 1;
    END IF;
  END LOOP;

  RAISE NOTICE 'Remediation complete: % leads re-routed, % skipped', v_moved, v_skip;
END;
$$;
