-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260730101702 name=hr_job_applicants_careers applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

ALTER TABLE public.job_applicants
  ADD COLUMN IF NOT EXISTS job_opening_id uuid REFERENCES public.job_openings(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS email          text,
  ADD COLUMN IF NOT EXISTS applied_via    text,
  ADD COLUMN IF NOT EXISTS cover_note     text;

ALTER TABLE public.job_applicants
  DROP CONSTRAINT IF EXISTS job_applicants_applied_via_check;
ALTER TABLE public.job_applicants
  ADD CONSTRAINT job_applicants_applied_via_check
  CHECK (applied_via IS NULL OR applied_via IN
    ('careers_portal','naukri','whatsapp','referral','walk_in','other'));

ALTER TABLE public.job_applicants
  DROP CONSTRAINT IF EXISTS job_applicants_source_channel_check;
ALTER TABLE public.job_applicants
  ADD CONSTRAINT job_applicants_source_channel_check
  CHECK (source_channel IN ('whatsapp','call','email','form','manual','other','careers_portal'));

ALTER TABLE public.job_applicants
  DROP CONSTRAINT IF EXISTS job_applicants_classification_source_check;
ALTER TABLE public.job_applicants
  ADD CONSTRAINT job_applicants_classification_source_check
  CHECK (classification_source IN ('regex','llm','manual','imported','careers_portal'));

CREATE UNIQUE INDEX IF NOT EXISTS job_applicants_careers_dedupe
  ON public.job_applicants (source_phone, COALESCE(job_opening_id, '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE lead_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_job_applicants_opening
  ON public.job_applicants (job_opening_id) WHERE job_opening_id IS NOT NULL;

DROP POLICY IF EXISTS "HR reads job_applicants" ON public.job_applicants;
CREATE POLICY "HR reads job_applicants"
  ON public.job_applicants FOR SELECT TO authenticated
  USING ('hr:view' = ANY(public.get_user_permissions(auth.uid())));

DROP POLICY IF EXISTS "HR manages job_applicants" ON public.job_applicants;
CREATE POLICY "HR manages job_applicants"
  ON public.job_applicants FOR ALL TO authenticated
  USING ('hr:recruitment_edit' = ANY(public.get_user_permissions(auth.uid())))
  WITH CHECK ('hr:recruitment_edit' = ANY(public.get_user_permissions(auth.uid())));

DROP VIEW IF EXISTS public.job_applicants_inbox;

CREATE VIEW public.job_applicants_inbox AS
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
  ja.job_opening_id,
  ja.applied_via,
  ja.cover_note,
  jo.title                  AS job_opening_title,
  COALESCE(ja.email, l.email) AS email,
  l.source                  AS lead_source,
  (SELECT content FROM whatsapp_messages wm
     WHERE wm.lead_id = ja.lead_id AND wm.direction='inbound'
     ORDER BY wm.created_at DESC LIMIT 1) AS last_message_preview,
  (SELECT count(*) FROM whatsapp_messages wm
     WHERE wm.lead_id = ja.lead_id AND wm.direction='inbound') AS inbound_message_count,
  prof.display_name         AS assigned_to_name
FROM public.job_applicants ja
LEFT JOIN public.leads l          ON l.id = ja.lead_id
LEFT JOIN public.job_openings jo  ON jo.id = ja.job_opening_id
LEFT JOIN public.profiles prof    ON prof.user_id = ja.assigned_to;

GRANT SELECT ON public.job_applicants_inbox TO authenticated;
