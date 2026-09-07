-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260730101554 name=job_applicants_table_prod_catchup applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

-- Catch-up: supabase/migrations/20260604120000_job_applicants_table.sql was
-- committed but never applied to prod (table absent, version absent from the
-- ledger). This applies ONLY the table/RLS/trigger/view/backfill sections.
--
-- Sections 5 and 6 of that file (fn_process_ai_call_queue and
-- get_unassigned_leads_bucket) are DELIBERATELY SKIPPED: prod already runs
-- newer definitions of get_unassigned_leads_bucket (later migrations), and
-- CREATE OR REPLACE with the June-4 body would revert the lead-bucket logic.

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

CREATE OR REPLACE FUNCTION public.tg_job_applicants_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_job_applicants_touch ON public.job_applicants;
CREATE TRIGGER trg_job_applicants_touch
  BEFORE UPDATE ON public.job_applicants
  FOR EACH ROW EXECUTE FUNCTION public.tg_job_applicants_touch();

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
  IF NEW.person_role IS DISTINCT FROM 'job_applicant' THEN
    RETURN NEW;
  END IF;

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

INSERT INTO public.job_applicants (lead_id, source_channel, source_phone, name, first_message_at, last_message_at, status, classification_source)
SELECT
  l.id, 'whatsapp', l.phone, l.name,
  (SELECT min(created_at) FROM whatsapp_messages wm WHERE wm.lead_id = l.id AND wm.direction='inbound'),
  (SELECT max(created_at) FROM whatsapp_messages wm WHERE wm.lead_id = l.id AND wm.direction='inbound'),
  'new', 'imported'
FROM public.leads l
WHERE l.person_role = 'job_applicant'
ON CONFLICT (lead_id) DO NOTHING;
