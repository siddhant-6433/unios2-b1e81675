-- Job Applicants module
-- WhatsApp messages that look like job/career enquiries should land here
-- (not in the admission lead bucket). HR works this list.
--
-- Person already has person_role='job_applicant' on the leads row (set by
-- auto_categorize_lead_from_message). This migration:
--   1) creates a dedicated job_applicants table for HR-specific fields
--   2) keeps it in sync via a trigger on leads.person_role
--   3) backfills existing job_applicant leads
--   4) hardens the AI call queue guard with a person_role check

-- ── 1. Table ────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.job_applicants (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id             uuid REFERENCES public.leads(id) ON DELETE CASCADE,
  source_message_id   uuid REFERENCES public.whatsapp_messages(id) ON DELETE SET NULL,
  source_channel      text NOT NULL DEFAULT 'whatsapp' CHECK (source_channel IN ('whatsapp','call','email','form','manual','other')),
  source_phone        text,
  name                text,
  desired_role        text,
  experience_years    numeric,
  resume_url          text,
  classification_source text NOT NULL DEFAULT 'regex' CHECK (classification_source IN ('regex','llm','manual','imported')),
  ai_intent           text,
  ai_confidence       numeric,
  ai_reasoning        text,
  status              text NOT NULL DEFAULT 'new' CHECK (status IN ('new','reviewing','shortlisted','interview','rejected','hired','withdrawn')),
  assigned_to         uuid REFERENCES auth.users(id),
  notes               text,
  first_message_at    timestamptz,
  last_message_at     timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (lead_id)
);

CREATE INDEX IF NOT EXISTS idx_job_applicants_status   ON public.job_applicants(status);
CREATE INDEX IF NOT EXISTS idx_job_applicants_assigned ON public.job_applicants(assigned_to) WHERE assigned_to IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_job_applicants_phone    ON public.job_applicants(source_phone);

ALTER TABLE public.job_applicants ENABLE ROW LEVEL SECURITY;

-- Admins manage; counsellors read-only (so they can see why a lead disappeared
-- if they search for it). HR-specific roles can be added later via has_role.
DROP POLICY IF EXISTS "Admins manage job_applicants" ON public.job_applicants;
CREATE POLICY "Admins manage job_applicants"
  ON public.job_applicants FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin')
    OR public.has_role(auth.uid(), 'campus_admin')
    OR public.has_role(auth.uid(), 'admission_head')
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'super_admin')
    OR public.has_role(auth.uid(), 'campus_admin')
    OR public.has_role(auth.uid(), 'admission_head')
  );

DROP POLICY IF EXISTS "Counsellors read job_applicants" ON public.job_applicants;
CREATE POLICY "Counsellors read job_applicants"
  ON public.job_applicants FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'counsellor'));

GRANT ALL ON public.job_applicants TO authenticated;
GRANT ALL ON public.job_applicants TO service_role;

-- updated_at trigger
CREATE OR REPLACE FUNCTION public.tg_job_applicants_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_job_applicants_touch ON public.job_applicants;
CREATE TRIGGER trg_job_applicants_touch
  BEFORE UPDATE ON public.job_applicants
  FOR EACH ROW EXECUTE FUNCTION public.tg_job_applicants_touch();

-- ── 2. Sync trigger: leads.person_role → job_applicants ─────────────────────

CREATE OR REPLACE FUNCTION public.tg_sync_job_applicant_from_lead()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_first_msg timestamptz;
  v_last_msg  timestamptz;
  v_msg_id    uuid;
BEGIN
  -- Only act when person_role lands on 'job_applicant'
  IF NEW.person_role IS DISTINCT FROM 'job_applicant' THEN
    RETURN NEW;
  END IF;

  -- Pull first/last inbound WhatsApp message timestamps for the lead
  SELECT min(created_at), max(created_at), (array_agg(id ORDER BY created_at))[1]
    INTO v_first_msg, v_last_msg, v_msg_id
  FROM whatsapp_messages
  WHERE lead_id = NEW.id AND direction = 'inbound';

  INSERT INTO public.job_applicants (
    lead_id, source_message_id, source_channel, source_phone,
    name, first_message_at, last_message_at, status
  )
  VALUES (
    NEW.id, v_msg_id, 'whatsapp', NEW.phone,
    NEW.name, v_first_msg, v_last_msg, 'new'
  )
  ON CONFLICT (lead_id) DO UPDATE
    SET name             = COALESCE(public.job_applicants.name, EXCLUDED.name),
        last_message_at  = GREATEST(
                             COALESCE(public.job_applicants.last_message_at, EXCLUDED.last_message_at),
                             EXCLUDED.last_message_at
                           ),
        source_phone     = COALESCE(public.job_applicants.source_phone, EXCLUDED.source_phone);

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_job_applicant_from_lead ON public.leads;
CREATE TRIGGER trg_sync_job_applicant_from_lead
  AFTER INSERT OR UPDATE OF person_role ON public.leads
  FOR EACH ROW
  WHEN (NEW.person_role = 'job_applicant')
  EXECUTE FUNCTION public.tg_sync_job_applicant_from_lead();

-- ── 3. View: HR inbox ───────────────────────────────────────────────────────

CREATE OR REPLACE VIEW public.job_applicants_inbox AS
SELECT
  ja.id,
  ja.lead_id,
  ja.status,
  ja.name,
  ja.source_phone           AS phone,
  ja.desired_role,
  ja.experience_years,
  ja.resume_url,
  ja.classification_source,
  ja.ai_intent,
  ja.ai_confidence,
  ja.ai_reasoning,
  ja.assigned_to,
  ja.first_message_at,
  ja.last_message_at,
  ja.created_at,
  ja.updated_at,
  l.email,
  l.source                  AS lead_source,
  -- last inbound message preview
  (SELECT content FROM whatsapp_messages wm
     WHERE wm.lead_id = ja.lead_id AND wm.direction='inbound'
     ORDER BY wm.created_at DESC LIMIT 1) AS last_message_preview,
  (SELECT count(*) FROM whatsapp_messages wm
     WHERE wm.lead_id = ja.lead_id AND wm.direction='inbound') AS inbound_message_count,
  prof.display_name         AS assigned_to_name
FROM public.job_applicants ja
LEFT JOIN public.leads l       ON l.id = ja.lead_id
LEFT JOIN public.profiles prof ON prof.user_id = ja.assigned_to;

GRANT SELECT ON public.job_applicants_inbox TO authenticated;

-- ── 4. Backfill existing job_applicant leads ────────────────────────────────

INSERT INTO public.job_applicants (lead_id, source_channel, source_phone, name, first_message_at, last_message_at, status, classification_source)
SELECT
  l.id,
  'whatsapp',
  l.phone,
  l.name,
  (SELECT min(created_at) FROM whatsapp_messages wm WHERE wm.lead_id = l.id AND wm.direction='inbound'),
  (SELECT max(created_at) FROM whatsapp_messages wm WHERE wm.lead_id = l.id AND wm.direction='inbound'),
  'new',
  'imported'
FROM public.leads l
WHERE l.person_role = 'job_applicant'
ON CONFLICT (lead_id) DO NOTHING;

-- ── 5. Harden AI call queue guard: also skip by person_role ─────────────────

CREATE OR REPLACE FUNCTION public.fn_process_ai_call_queue()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item record;
  v_url text;
  v_key text;
  v_lead_stage text;
  v_lead_role  text;
BEGIN
  SELECT value INTO v_url FROM _app_config WHERE key = 'supabase_url';
  SELECT value INTO v_key FROM _app_config WHERE key = 'service_role_key';
  IF v_url IS NULL OR v_key IS NULL THEN RETURN; END IF;

  SELECT * INTO v_item
  FROM ai_call_queue
  WHERE status = 'pending' AND scheduled_at <= now()
  ORDER BY scheduled_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF v_item IS NULL THEN RETURN; END IF;

  SELECT stage::text, person_role
    INTO v_lead_stage, v_lead_role
  FROM leads WHERE id = v_item.lead_id;

  IF v_lead_stage IN ('not_interested','dnc','rejected','ineligible','admitted')
     OR v_lead_role IN ('job_applicant','vendor','student','alumni','other')
  THEN
    UPDATE ai_call_queue
       SET status = 'skipped',
           error_message = 'Skipped: stage=' || coalesce(v_lead_stage,'?') || ' role=' || coalesce(v_lead_role,'?'),
           completed_at = now()
     WHERE id = v_item.id;
    RETURN;
  END IF;

  UPDATE ai_call_queue SET status = 'processing', started_at = now() WHERE id = v_item.id;

  BEGIN
    PERFORM net.http_post(
      url := v_url || '/functions/v1/voice-call',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_key
      ),
      body := jsonb_build_object('action','outbound','lead_id', v_item.lead_id)
    );
    UPDATE ai_call_queue SET status = 'completed', completed_at = now() WHERE id = v_item.id;
  EXCEPTION WHEN OTHERS THEN
    UPDATE ai_call_queue SET status = 'failed', error_message = SQLERRM, completed_at = now() WHERE id = v_item.id;
  END;
END;
$$;

-- ── 6. Lead bucket: exclude non-lead person_roles ──────────────────────────
-- View is backed by SECURITY DEFINER fn get_unassigned_leads_bucket(); update that.

CREATE OR REPLACE FUNCTION public.get_unassigned_leads_bucket()
RETURNS TABLE (
  id uuid,
  name text,
  phone text,
  email text,
  stage text,
  source text,
  course_id uuid,
  campus_id uuid,
  created_at timestamptz,
  lead_score int,
  lead_temperature text,
  course_name text,
  campus_name text,
  bucket text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    l.id,
    l.name,
    l.phone,
    l.email,
    l.stage::text,
    l.source::text,
    l.course_id,
    l.campus_id,
    l.created_at,
    l.lead_score,
    l.lead_temperature,
    c.name AS course_name,
    cam.name AS campus_name,
    CASE
      WHEN i.type IS NOT NULL THEN i.type
      WHEN jdm.is_school = true THEN 'school'
      ELSE 'college'
    END AS bucket
  FROM leads l
  LEFT JOIN courses c ON c.id = l.course_id
  LEFT JOIN departments d ON d.id = c.department_id
  LEFT JOIN institutions i ON i.id = d.institution_id
  LEFT JOIN campuses cam ON cam.id = l.campus_id
  LEFT JOIN jd_category_mappings jdm ON lower(jdm.category) = lower(l.jd_category)
  WHERE l.counsellor_id IS NULL
    AND l.stage NOT IN ('admitted', 'rejected')
    AND COALESCE(l.person_role, 'lead') = 'lead';
$$;
