-- Lead Mirroring: Auto-create mirror leads between NIMT Beacon (CBSE) and Mirai (IB) schools

-- 1. Add mirror_lead_id column to link paired leads
ALTER TABLE public.leads ADD COLUMN IF NOT EXISTS mirror_lead_id uuid REFERENCES public.leads(id);

-- 2. Trigger function: auto-create mirror on school lead INSERT
CREATE OR REPLACE FUNCTION public.fn_mirror_school_lead()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_course_id uuid;
  v_inst_id uuid;
  v_inst_type text;
  v_mirror_campus_id uuid;
  v_mirror_id uuid;

  -- Campus IDs
  BEACON_CAMPUS_ID constant uuid := '9bb6b4cc-c992-4af1-b9d3-384537a510c8';
  MIRAI_CAMPUS_ID constant uuid := 'c0000002-0000-0000-0000-000000000001';
BEGIN
  -- Skip if already a mirror (prevent infinite recursion)
  IF NEW.is_mirror = true THEN RETURN NEW; END IF;

  -- Skip if mirror_lead_id already set (already mirrored)
  IF NEW.mirror_lead_id IS NOT NULL THEN RETURN NEW; END IF;

  -- Check if this lead's campus is a school campus that needs mirroring
  IF NEW.campus_id = BEACON_CAMPUS_ID THEN
    v_mirror_campus_id := MIRAI_CAMPUS_ID;
  ELSIF NEW.campus_id = MIRAI_CAMPUS_ID THEN
    v_mirror_campus_id := BEACON_CAMPUS_ID;
  ELSE
    -- Also check via course → department → institution.type
    IF NEW.course_id IS NOT NULL THEN
      SELECT i.type, i.campus_id INTO v_inst_type, v_mirror_campus_id
      FROM courses c
      JOIN departments d ON d.id = c.department_id
      JOIN institutions i ON i.id = d.institution_id
      WHERE c.id = NEW.course_id;

      IF v_inst_type != 'school' THEN
        RETURN NEW; -- Not a school lead, no mirroring needed
      END IF;

      -- Determine mirror campus
      IF v_mirror_campus_id = BEACON_CAMPUS_ID THEN
        v_mirror_campus_id := MIRAI_CAMPUS_ID;
      ELSIF v_mirror_campus_id = MIRAI_CAMPUS_ID THEN
        v_mirror_campus_id := BEACON_CAMPUS_ID;
      ELSE
        RETURN NEW; -- Unknown school campus
      END IF;
    ELSE
      RETURN NEW; -- No course, no campus match → skip
    END IF;
  END IF;

  -- Create mirror lead
  INSERT INTO public.leads (
    name, phone, email, guardian_name, guardian_phone,
    stage, source, source_lead_id,
    campus_id, is_mirror,
    person_role, lead_score, lead_temperature
  ) VALUES (
    NEW.name, NEW.phone, NEW.email, NEW.guardian_name, NEW.guardian_phone,
    'new_lead', NEW.source, NEW.source_lead_id,
    v_mirror_campus_id, true,
    NEW.person_role, NEW.lead_score, NEW.lead_temperature
  )
  RETURNING id INTO v_mirror_id;

  -- Link both leads
  UPDATE public.leads SET mirror_lead_id = v_mirror_id WHERE id = NEW.id;
  UPDATE public.leads SET mirror_lead_id = NEW.id WHERE id = v_mirror_id;

  RETURN NEW;
EXCEPTION WHEN OTHERS THEN
  -- Don't block lead creation if mirroring fails
  RAISE WARNING 'Lead mirroring failed: %', SQLERRM;
  RETURN NEW;
END;
$$;

-- 3. Create trigger (AFTER INSERT to avoid recursion issues with RETURNING)
DROP TRIGGER IF EXISTS trg_mirror_school_lead ON public.leads;
CREATE TRIGGER trg_mirror_school_lead
  AFTER INSERT ON public.leads
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_mirror_school_lead();

-- 4. Backfill: create mirrors for existing school leads that don't have mirrors
DO $$
DECLARE
  r RECORD;
  v_mirror_campus uuid;
  v_mirror_id uuid;
BEGIN
  FOR r IN
    SELECT l.id, l.name, l.phone, l.email, l.guardian_name, l.guardian_phone,
           l.source, l.source_lead_id, l.campus_id, l.person_role,
           l.lead_score, l.lead_temperature, l.stage
    FROM leads l
    JOIN courses c ON c.id = l.course_id
    JOIN departments d ON d.id = c.department_id
    JOIN institutions i ON i.id = d.institution_id
    WHERE i.type = 'school'
      AND l.is_mirror = false
      AND l.mirror_lead_id IS NULL
      AND l.campus_id IN (
        '9bb6b4cc-c992-4af1-b9d3-384537a510c8',
        'c0000002-0000-0000-0000-000000000001'
      )
  LOOP
    IF r.campus_id = '9bb6b4cc-c992-4af1-b9d3-384537a510c8' THEN
      v_mirror_campus := 'c0000002-0000-0000-0000-000000000001';
    ELSE
      v_mirror_campus := '9bb6b4cc-c992-4af1-b9d3-384537a510c8';
    END IF;

    INSERT INTO leads (
      name, phone, email, guardian_name, guardian_phone,
      stage, source, source_lead_id,
      campus_id, is_mirror, mirror_lead_id,
      person_role, lead_score, lead_temperature
    ) VALUES (
      r.name, r.phone, r.email, r.guardian_name, r.guardian_phone,
      r.stage, r.source, r.source_lead_id,
      v_mirror_campus, true, r.id,
      r.person_role, r.lead_score, r.lead_temperature
    )
    RETURNING id INTO v_mirror_id;

    UPDATE leads SET mirror_lead_id = v_mirror_id WHERE id = r.id;
  END LOOP;
END $$;
