-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260905061650 name=cold_call_polymorphic_call_tables applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

ALTER TABLE public.call_logs
  ADD COLUMN IF NOT EXISTS contact_id uuid REFERENCES public.marketing_contacts(id) ON DELETE SET NULL;

ALTER TABLE public.call_logs ALTER COLUMN lead_id DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'call_logs_one_target') THEN
    ALTER TABLE public.call_logs
      ADD CONSTRAINT call_logs_one_target
      CHECK ((lead_id IS NOT NULL) <> (contact_id IS NOT NULL)) NOT VALID;
    ALTER TABLE public.call_logs VALIDATE CONSTRAINT call_logs_one_target;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS call_logs_contact_idx
  ON public.call_logs (contact_id) WHERE contact_id IS NOT NULL;

ALTER TABLE public.ai_call_records
  ADD COLUMN IF NOT EXISTS contact_id uuid REFERENCES public.marketing_contacts(id) ON DELETE SET NULL;

ALTER TABLE public.ai_call_records ALTER COLUMN lead_id DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_call_records_one_target') THEN
    ALTER TABLE public.ai_call_records
      ADD CONSTRAINT ai_call_records_one_target
      CHECK ((lead_id IS NOT NULL) <> (contact_id IS NOT NULL)) NOT VALID;
    ALTER TABLE public.ai_call_records VALIDATE CONSTRAINT ai_call_records_one_target;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS ai_call_records_contact_idx
  ON public.ai_call_records (contact_id) WHERE contact_id IS NOT NULL;

ALTER TABLE public.lead_list_members
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_llm_cold_due
  ON public.lead_list_members (list_id, assigned_to, next_attempt_at)
  WHERE work_status = 'pending' AND contact_id IS NOT NULL;

COMMENT ON COLUMN public.call_logs.contact_id IS
  'Cold call against a marketing_contacts row that is not yet a lead. Nulled and replaced by lead_id when the contact is promoted, so the history follows the person.';
COMMENT ON COLUMN public.lead_list_members.next_attempt_at IS
  'Cold-call retry gate: member stays pending but is hidden from the dialer queue until this time. NULL = due now.';
