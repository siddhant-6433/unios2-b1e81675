-- Restore lead mirroring (Beacon ↔ Mirai school pairing).
--
-- Three things went wrong since the original mirror trigger landed:
--
-- 1. The merge-duplicates migration (20260515190000) added a unique index on
--    `phone WHERE phone IS NOT NULL`. Mirror rows must share the phone with
--    their original — the unique violation killed every mirror INSERT. The
--    trigger's EXCEPTION WHEN OTHERS swallowed the error, so failures were
--    invisible. Net effect: 0 of 459 JD school leads (and 0 of every other
--    school lead since 2026-05-15) actually got mirrored.
--
-- 2. JustDial school leads come in with course_id=NULL (the JD category
--    keyword maps to is_school=true rather than a specific course) and often
--    campus_id=NULL (brancharea/city lookup misses). The trigger required
--    either campus_id ∈ {Beacon, Mirai} or course_id NOT NULL, so JD school
--    leads fell through every branch.
--
-- 3. Secondary AFTER-INSERT triggers (AI call queue, WA welcome, automation
--    engine) didn't skip is_mirror=true, so once mirroring works each pair
--    would double-fire outreach. Mirrors are placeholders for the other team
--    to claim — they should be quiet until manually picked up.
--
-- Fix order: unique index → mirror trigger → secondary triggers → backfill.


-- ── 1. Allow mirror rows to share phones with their originals ───────────
DROP INDEX IF EXISTS public.idx_leads_phone_unique;
CREATE UNIQUE INDEX idx_leads_phone_unique
  ON public.leads (phone)
  WHERE phone IS NOT NULL AND is_mirror = false;


-- ── 2. Mirror trigger: handle JD school leads, stop swallowing errors ───
CREATE OR REPLACE FUNCTION public.fn_mirror_school_lead()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_inst_type        text;
  v_course_campus    uuid;
  v_mirror_campus_id uuid;
  v_jd_is_school     boolean;
  v_mirror_id        uuid;

  BEACON_CAMPUS_ID constant uuid := '9bb6b4cc-c992-4af1-b9d3-384537a510c8';
  MIRAI_CAMPUS_ID  constant uuid := 'c0000002-0000-0000-0000-000000000001';
BEGIN
  -- Recursion guard
  IF NEW.is_mirror = true THEN RETURN NEW; END IF;
  IF NEW.mirror_lead_id IS NOT NULL THEN RETURN NEW; END IF;

  -- Path A: campus already pinned to a school side
  IF NEW.campus_id = BEACON_CAMPUS_ID THEN
    v_mirror_campus_id := MIRAI_CAMPUS_ID;
  ELSIF NEW.campus_id = MIRAI_CAMPUS_ID THEN
    v_mirror_campus_id := BEACON_CAMPUS_ID;

  -- Path B: course resolves to a school institution → mirror to other side
  ELSIF NEW.course_id IS NOT NULL THEN
    SELECT i.type, i.campus_id
      INTO v_inst_type, v_course_campus
    FROM public.courses c
    JOIN public.departments d  ON d.id = c.department_id
    JOIN public.institutions i ON i.id = d.institution_id
    WHERE c.id = NEW.course_id
    LIMIT 1;

    IF v_inst_type IS DISTINCT FROM 'school' THEN
      RETURN NEW;
    END IF;

    IF v_course_campus = BEACON_CAMPUS_ID THEN
      v_mirror_campus_id := MIRAI_CAMPUS_ID;
    ELSIF v_course_campus = MIRAI_CAMPUS_ID THEN
      v_mirror_campus_id := BEACON_CAMPUS_ID;
    ELSE
      RETURN NEW;  -- school course on some other campus → not a pairing case
    END IF;

  -- Path C: JustDial school category (no course, no campus) → default
  -- canonical side to Beacon, mirror to Mirai. Reasoning: most JD school
  -- categories ("Cbse Schools", "Boarding Schools", "Nursery Schools" etc.)
  -- map naturally to the CBSE side; the Mirai team picks up the mirror.
  ELSIF NEW.source = 'justdial'::lead_source AND NEW.jd_category IS NOT NULL THEN
    SELECT is_school INTO v_jd_is_school
    FROM public.jd_category_mappings
    WHERE lower(category) = lower(NEW.jd_category)
    LIMIT 1;

    IF v_jd_is_school IS NOT TRUE THEN
      RETURN NEW;
    END IF;

    -- Pin the original to Beacon if it has no campus yet
    IF NEW.campus_id IS NULL THEN
      UPDATE public.leads SET campus_id = BEACON_CAMPUS_ID WHERE id = NEW.id;
    END IF;
    v_mirror_campus_id := MIRAI_CAMPUS_ID;

  ELSE
    RETURN NEW;
  END IF;

  -- Create the mirror
  INSERT INTO public.leads (
    name, phone, email, guardian_name, guardian_phone,
    stage, source, source_lead_id,
    campus_id, is_mirror,
    person_role, lead_score, lead_temperature,
    jd_category, jd_contract_id,
    city, area, notes
  ) VALUES (
    NEW.name, NEW.phone, NEW.email, NEW.guardian_name, NEW.guardian_phone,
    'new_lead', NEW.source, NEW.source_lead_id,
    v_mirror_campus_id, true,
    NEW.person_role, NEW.lead_score, NEW.lead_temperature,
    NEW.jd_category, NEW.jd_contract_id,
    NEW.city, NEW.area, NEW.notes
  )
  RETURNING id INTO v_mirror_id;

  UPDATE public.leads SET mirror_lead_id = v_mirror_id WHERE id = NEW.id;
  UPDATE public.leads SET mirror_lead_id = NEW.id      WHERE id = v_mirror_id;

  RETURN NEW;
END;
$$;


-- ── 3. Secondary AFTER-INSERT triggers: skip mirrors ────────────────────
-- Mirrors are placeholders for the other team. They should not queue AI
-- calls, send welcome WA messages, or fire automation rules. The team that
-- claims the mirror will trigger its own outreach manually.

CREATE OR REPLACE FUNCTION public.fn_auto_ai_call_new_lead()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_delay_min int;
BEGIN
  IF NEW.is_mirror = true THEN RETURN NEW; END IF;
  IF NEW.skip_ai_call = true THEN RETURN NEW; END IF;
  IF NEW.phone IS NULL OR NEW.phone = '' THEN RETURN NEW; END IF;

  CASE NEW.source
    WHEN 'website', 'website_chat', 'mirai_website',
         'meta_ads', 'google_ads', 'whatsapp', 'enquiry'
      THEN v_delay_min := 4;
    WHEN 'collegedunia', 'collegehai', 'salahlo', 'justdial', 'shiksha'
      THEN v_delay_min := 30;
    WHEN 'consultant', 'walk_in', 'reference', 'referral', 'education_fair'
      THEN RETURN NEW;
    ELSE v_delay_min := 4;
  END CASE;

  INSERT INTO ai_call_queue (lead_id, status, scheduled_at)
  VALUES (NEW.id, 'pending', fn_next_business_hour(v_delay_min))
  ON CONFLICT (lead_id) WHERE status = 'pending' DO NOTHING;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'AI call queue insert failed: %', SQLERRM;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_auto_welcome_lead()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_course_name  text;
  v_source_label text;
  v_url          text;
  v_secret       text;
BEGIN
  IF NEW.is_mirror = true THEN RETURN NEW; END IF;

  SELECT name INTO v_course_name FROM public.courses WHERE id = NEW.course_id;
  v_course_name := COALESCE(v_course_name, 'our programmes');
  v_source_label := INITCAP(REPLACE(NEW.source::text, '_', ' '));

  SELECT decrypted_secret INTO v_url    FROM vault.decrypted_secrets WHERE name = 'SUPABASE_URL' LIMIT 1;
  SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = 'CRON_SECRET'  LIMIT 1;

  IF v_url IS NULL OR v_secret IS NULL THEN RETURN NEW; END IF;

  IF NEW.phone IS NOT NULL AND length(NEW.phone) >= 10 THEN
    PERFORM net.http_post(
      url     := v_url || '/functions/v1/whatsapp-send',
      headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
      body    := jsonb_build_object(
        'template_key', 'lead_welcome',
        'phone',        NEW.phone,
        'params',       jsonb_build_array(NEW.name, v_course_name, v_source_label),
        'lead_id',      NEW.id
      )
    );
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.fn_automation_on_lead_created()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url    text;
  v_secret text;
BEGIN
  IF NEW.is_mirror = true THEN RETURN NEW; END IF;

  SELECT decrypted_secret INTO v_url    FROM vault.decrypted_secrets WHERE name = 'SUPABASE_URL' LIMIT 1;
  SELECT decrypted_secret INTO v_secret FROM vault.decrypted_secrets WHERE name = 'CRON_SECRET'  LIMIT 1;
  IF v_url IS NULL OR v_secret IS NULL THEN RETURN NEW; END IF;

  PERFORM net.http_post(
    url     := v_url || '/functions/v1/automation-engine',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
    body    := jsonb_build_object('trigger_type', 'lead_created', 'lead_id', NEW.id, 'new_stage', NEW.stage)
  );
  RETURN NEW;
END;
$$;


-- ── 4. Backfill mirrors for school leads that lost theirs ───────────────
-- Covers two populations:
--   (a) Pre-existing school leads on Beacon/Mirai campuses with no mirror
--   (b) JD school leads (jd_category_mappings.is_school=true) with no campus
--       — these get pinned to Beacon, mirrored to Mirai
-- Skips leads at terminal stages (admitted/rejected/not_interested) since
-- mirroring them is wasted work.

DO $$
DECLARE
  r              RECORD;
  v_mirror_campus uuid;
  v_mirror_id     uuid;
  BEACON_ID constant uuid := '9bb6b4cc-c992-4af1-b9d3-384537a510c8';
  MIRAI_ID  constant uuid := 'c0000002-0000-0000-0000-000000000001';
BEGIN
  -- (a) School leads on Beacon/Mirai campuses missing mirror
  FOR r IN
    SELECT l.*
    FROM public.leads l
    WHERE l.is_mirror = false
      AND l.mirror_lead_id IS NULL
      AND l.campus_id IN (BEACON_ID, MIRAI_ID)
      AND l.stage NOT IN ('admitted', 'rejected', 'not_interested')
  LOOP
    v_mirror_campus := CASE WHEN r.campus_id = BEACON_ID THEN MIRAI_ID ELSE BEACON_ID END;

    INSERT INTO public.leads (
      name, phone, email, guardian_name, guardian_phone,
      stage, source, source_lead_id,
      campus_id, is_mirror, mirror_lead_id,
      person_role, lead_score, lead_temperature,
      jd_category, jd_contract_id, city, area, notes
    ) VALUES (
      r.name, r.phone, r.email, r.guardian_name, r.guardian_phone,
      'new_lead', r.source, r.source_lead_id,
      v_mirror_campus, true, r.id,
      r.person_role, r.lead_score, r.lead_temperature,
      r.jd_category, r.jd_contract_id, r.city, r.area, r.notes
    )
    RETURNING id INTO v_mirror_id;

    UPDATE public.leads SET mirror_lead_id = v_mirror_id WHERE id = r.id;
  END LOOP;

  -- (b) JD school leads with NULL campus → pin to Beacon, mirror to Mirai
  FOR r IN
    SELECT l.*
    FROM public.leads l
    JOIN public.jd_category_mappings jdm
      ON lower(jdm.category) = lower(l.jd_category)
    WHERE l.is_mirror = false
      AND l.mirror_lead_id IS NULL
      AND l.campus_id IS NULL
      AND l.source = 'justdial'::lead_source
      AND jdm.is_school = true
      AND l.stage NOT IN ('admitted', 'rejected', 'not_interested')
  LOOP
    UPDATE public.leads SET campus_id = BEACON_ID WHERE id = r.id;

    INSERT INTO public.leads (
      name, phone, email, guardian_name, guardian_phone,
      stage, source, source_lead_id,
      campus_id, is_mirror, mirror_lead_id,
      person_role, lead_score, lead_temperature,
      jd_category, jd_contract_id, city, area, notes
    ) VALUES (
      r.name, r.phone, r.email, r.guardian_name, r.guardian_phone,
      'new_lead', r.source, r.source_lead_id,
      MIRAI_ID, true, r.id,
      r.person_role, r.lead_score, r.lead_temperature,
      r.jd_category, r.jd_contract_id, r.city, r.area, r.notes
    )
    RETURNING id INTO v_mirror_id;

    UPDATE public.leads SET mirror_lead_id = v_mirror_id WHERE id = r.id;
  END LOOP;
END $$;
