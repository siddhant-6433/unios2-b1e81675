-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260817145512 name=email_ai_reply applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

-- Email reply agent: inbound/threading columns on email_messages, a per-mailbox
-- settings/toggle table, and the poller cron. Idempotent so it survives re-runs
-- and MCP-applied drift.

-- ── 1. Extend email_messages for inbound + Gmail threading + AI metadata ──────
ALTER TABLE public.email_messages
  ADD COLUMN IF NOT EXISTS direction        text NOT NULL DEFAULT 'outbound',
  ADD COLUMN IF NOT EXISTS gmail_message_id text,
  ADD COLUMN IF NOT EXISTS gmail_thread_id  text,
  ADD COLUMN IF NOT EXISTS in_reply_to      text,
  ADD COLUMN IF NOT EXISTS mailbox          text,
  ADD COLUMN IF NOT EXISTS body_text        text,
  ADD COLUMN IF NOT EXISTS ai_generated     boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ai_confidence    numeric;

-- direction guard
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'email_messages_direction_check'
  ) THEN
    ALTER TABLE public.email_messages
      ADD CONSTRAINT email_messages_direction_check
      CHECK (direction IN ('inbound','outbound'));
  END IF;
END $$;

-- widen the status CHECK to include 'draft' (low-confidence Gmail drafts)
DO $$
DECLARE
  con text;
BEGIN
  SELECT conname INTO con
  FROM pg_constraint
  WHERE conrelid = 'public.email_messages'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%status%';
  IF con IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.email_messages DROP CONSTRAINT %I', con);
  END IF;
  ALTER TABLE public.email_messages
    ADD CONSTRAINT email_messages_status_check
    CHECK (status IN ('queued','sent','delivered','bounced','failed','draft'));
END $$;

-- one row per inbound Gmail message → dedup / never double-reply
CREATE UNIQUE INDEX IF NOT EXISTS uq_email_messages_gmail_message_id
  ON public.email_messages(gmail_message_id)
  WHERE gmail_message_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_email_messages_thread
  ON public.email_messages(gmail_thread_id)
  WHERE gmail_thread_id IS NOT NULL;

-- ── 2. Per-mailbox settings / toggle ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.email_ai_settings (
  mailbox              text PRIMARY KEY,
  enabled              boolean NOT NULL DEFAULT true,
  auto_send            boolean NOT NULL DEFAULT true,
  confidence_threshold numeric NOT NULL DEFAULT 0.7,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.email_ai_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Authenticated manage email_ai_settings" ON public.email_ai_settings;
CREATE POLICY "Authenticated manage email_ai_settings"
  ON public.email_ai_settings FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Explicit grants (this repo has had missing service_role grants silently break
-- edge functions — grant up front).
GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_ai_settings TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.email_ai_settings TO authenticated;

-- Seed the primary admissions mailbox (enabled, auto-send on). Add careers@ or
-- others by inserting more rows.
INSERT INTO public.email_ai_settings (mailbox, enabled, auto_send, confidence_threshold)
VALUES ('admissions@nimt.ac.in', true, true, 0.7)
ON CONFLICT (mailbox) DO NOTHING;

-- ── 3. Poller cron ───────────────────────────────────────────────────────────
-- Every 5 minutes between 8 AM and 9 PM IST (= 2:30-15:30 UTC). Re-registering
-- with the same name updates the existing job.
CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.schedule(
  'email-ai-reply',
  '*/5 2-15 * * *',
  $$
  SELECT net.http_post(
    url     := (SELECT value FROM public._app_config WHERE key = 'supabase_url')
               || '/functions/v1/email-ai-reply',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (SELECT value FROM public._app_config WHERE key = 'service_role_key')
    ),
    body    := '{}'::jsonb
  )
  $$
);
