-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260709142842 name=whatsapp_conversation_state_reply_sla applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

ALTER TABLE public.whatsapp_conversation_state
  ADD COLUMN IF NOT EXISTS reply_due_at timestamptz,
  ADD COLUMN IF NOT EXISTS reply_escalation_level smallint NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_wcs_reply_due_at
  ON public.whatsapp_conversation_state (reply_due_at)
  WHERE reply_due_at IS NOT NULL;
