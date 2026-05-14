-- Team membership realignment.
--
-- Per ops review:
--   • Pushplata           → Grn BEd Admissions      (add)
--   • Nikki Bhati         → Grn Counselling         (add)
--   • Aishwarya Sharma    → NSAE II Admissions      (remove)
--   • Arun Choudhary      → NSAE II Admissions      (remove)
--   • Khushi Pandey       → NSAE II Admissions      (add)
--
-- People are resolved by profiles.display_name (single match expected).
-- Idempotent: INSERT ... ON CONFLICT DO NOTHING, DELETE only by id.

DO $$
DECLARE
  v_team_bed     uuid;
  v_team_cnsl    uuid;
  v_team_nsae    uuid;
  v_push_user    uuid;
  v_nikki_user   uuid;
  v_aish_user    uuid;
  v_arun_user    uuid;
  v_khushi_user  uuid;
BEGIN
  SELECT id INTO v_team_bed  FROM public.teams WHERE name = 'Grn BEd Admissions';
  SELECT id INTO v_team_cnsl FROM public.teams WHERE name = 'Grn Counselling';
  SELECT id INTO v_team_nsae FROM public.teams WHERE name = 'NSAE II Admissions';

  SELECT user_id INTO v_push_user   FROM public.profiles WHERE display_name = 'Pushplata';
  SELECT user_id INTO v_nikki_user  FROM public.profiles WHERE display_name = 'Nikki Bhati';
  SELECT user_id INTO v_aish_user   FROM public.profiles WHERE display_name = 'Aishwarya Sharma';
  SELECT user_id INTO v_arun_user   FROM public.profiles WHERE display_name = 'Arun Choudhary';
  SELECT user_id INTO v_khushi_user FROM public.profiles WHERE display_name = 'Khushi Pandey';

  -- Adds
  IF v_team_bed IS NOT NULL AND v_push_user IS NOT NULL THEN
    INSERT INTO public.team_members (team_id, user_id)
    VALUES (v_team_bed, v_push_user)
    ON CONFLICT DO NOTHING;
  END IF;

  IF v_team_cnsl IS NOT NULL AND v_nikki_user IS NOT NULL THEN
    INSERT INTO public.team_members (team_id, user_id)
    VALUES (v_team_cnsl, v_nikki_user)
    ON CONFLICT DO NOTHING;
  END IF;

  IF v_team_nsae IS NOT NULL AND v_khushi_user IS NOT NULL THEN
    INSERT INTO public.team_members (team_id, user_id)
    VALUES (v_team_nsae, v_khushi_user)
    ON CONFLICT DO NOTHING;
  END IF;

  -- Removes
  IF v_team_nsae IS NOT NULL THEN
    DELETE FROM public.team_members
     WHERE team_id = v_team_nsae
       AND user_id IN (v_aish_user, v_arun_user);
  END IF;
END;
$$;
