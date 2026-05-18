-- Personal document tracker (insurance, vehicle, pollution, etc.) — owned
-- by a small allow-list of staff users. Completely separate data plane from
-- the CRM: nothing here joins to leads/students/applications. Access is
-- gated by email (not role) because this is genuinely personal data.
--
-- Allow-list lives in personal_dashboard_users so we can add a spouse /
-- family member later without another migration. RLS reads auth.jwt() to
-- get the caller's email and looks them up.

-- ── Allow-list ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.personal_dashboard_users (
  email             text PRIMARY KEY,
  display_name      text,
  whatsapp_phone    text,            -- E.164, used by reminders + #mydoc ingest
  notify_whatsapp   boolean NOT NULL DEFAULT true,
  notify_email      boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.personal_dashboard_users (email, display_name, whatsapp_phone)
VALUES ('siddhant@nimt.ac.in', 'Siddhant', '+919871763193')
ON CONFLICT (email) DO UPDATE
  SET whatsapp_phone = EXCLUDED.whatsapp_phone;

-- Helper: is the calling JWT in the allow-list?
CREATE OR REPLACE FUNCTION public.is_personal_dashboard_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.personal_dashboard_users
    WHERE lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

GRANT EXECUTE ON FUNCTION public.is_personal_dashboard_user() TO authenticated, anon;

-- ── Documents ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.personal_documents (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_email     text NOT NULL REFERENCES public.personal_dashboard_users(email) ON DELETE CASCADE,
  doc_type        text NOT NULL CHECK (doc_type IN (
    'health_insurance','life_insurance','vehicle_insurance','vehicle_pollution',
    'vehicle_rc','driving_license','passport','aadhaar','pan','other'
  )),
  label           text NOT NULL,             -- human label e.g. "Hero Splendor PUC"
  file_path       text NOT NULL,             -- storage path in personal-documents bucket
  mime_type       text,
  source          text NOT NULL DEFAULT 'web' CHECK (source IN ('web','whatsapp')),
  issuer          text,
  policy_number   text,
  vehicle_reg     text,
  insured_name    text,
  issued_on       date,
  expires_on      date,
  raw_extracted   jsonb,                     -- full LLM extraction, kept for audit
  notes           text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_personal_documents_owner_expires
  ON public.personal_documents (owner_email, expires_on);

CREATE INDEX IF NOT EXISTS idx_personal_documents_owner_type
  ON public.personal_documents (owner_email, doc_type);

-- updated_at trigger
CREATE OR REPLACE FUNCTION public._personal_documents_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_personal_documents_updated_at ON public.personal_documents;
CREATE TRIGGER trg_personal_documents_updated_at
  BEFORE UPDATE ON public.personal_documents
  FOR EACH ROW EXECUTE FUNCTION public._personal_documents_set_updated_at();

-- ── Reminder dedupe ─────────────────────────────────────────────────────
-- Track which reminder milestones have been sent for each doc so the daily
-- cron is idempotent.
CREATE TABLE IF NOT EXISTS public.personal_doc_reminders_sent (
  document_id     uuid NOT NULL REFERENCES public.personal_documents(id) ON DELETE CASCADE,
  milestone       text NOT NULL CHECK (milestone IN ('30d','7d','1d','expired')),
  sent_at         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (document_id, milestone)
);

-- ── RLS ─────────────────────────────────────────────────────────────────
ALTER TABLE public.personal_dashboard_users  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.personal_documents        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.personal_doc_reminders_sent ENABLE ROW LEVEL SECURITY;

-- Allow-list table: a user can see their own row only.
DROP POLICY IF EXISTS "self read personal_dashboard_users" ON public.personal_dashboard_users;
CREATE POLICY "self read personal_dashboard_users"
  ON public.personal_dashboard_users
  FOR SELECT TO authenticated
  USING (lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));

DROP POLICY IF EXISTS "self update personal_dashboard_users" ON public.personal_dashboard_users;
CREATE POLICY "self update personal_dashboard_users"
  ON public.personal_dashboard_users
  FOR UPDATE TO authenticated
  USING (lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')))
  WITH CHECK (lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));

-- personal_documents: full CRUD restricted to the owning email (which must
-- exist in the allow-list — FK enforces that).
DROP POLICY IF EXISTS "owner read personal_documents" ON public.personal_documents;
CREATE POLICY "owner read personal_documents"
  ON public.personal_documents
  FOR SELECT TO authenticated
  USING (lower(owner_email) = lower(coalesce(auth.jwt() ->> 'email', '')));

DROP POLICY IF EXISTS "owner insert personal_documents" ON public.personal_documents;
CREATE POLICY "owner insert personal_documents"
  ON public.personal_documents
  FOR INSERT TO authenticated
  WITH CHECK (
    lower(owner_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    AND public.is_personal_dashboard_user()
  );

DROP POLICY IF EXISTS "owner update personal_documents" ON public.personal_documents;
CREATE POLICY "owner update personal_documents"
  ON public.personal_documents
  FOR UPDATE TO authenticated
  USING (lower(owner_email) = lower(coalesce(auth.jwt() ->> 'email', '')))
  WITH CHECK (lower(owner_email) = lower(coalesce(auth.jwt() ->> 'email', '')));

DROP POLICY IF EXISTS "owner delete personal_documents" ON public.personal_documents;
CREATE POLICY "owner delete personal_documents"
  ON public.personal_documents
  FOR DELETE TO authenticated
  USING (lower(owner_email) = lower(coalesce(auth.jwt() ->> 'email', '')));

-- Reminders log: owner can read their own; service role manages writes.
DROP POLICY IF EXISTS "owner read personal_doc_reminders" ON public.personal_doc_reminders_sent;
CREATE POLICY "owner read personal_doc_reminders"
  ON public.personal_doc_reminders_sent
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.personal_documents d
    WHERE d.id = personal_doc_reminders_sent.document_id
      AND lower(d.owner_email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  ));

-- ── Storage bucket ──────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('personal-documents', 'personal-documents', false)
ON CONFLICT (id) DO NOTHING;

-- Files are stored under `<owner_email>/<uuid>.<ext>`. RLS uses the first
-- path segment as the owner key.
DROP POLICY IF EXISTS "personal-docs read own"   ON storage.objects;
DROP POLICY IF EXISTS "personal-docs insert own" ON storage.objects;
DROP POLICY IF EXISTS "personal-docs delete own" ON storage.objects;
DROP POLICY IF EXISTS "personal-docs update own" ON storage.objects;

CREATE POLICY "personal-docs read own"
  ON storage.objects FOR SELECT TO authenticated
  USING (
    bucket_id = 'personal-documents'
    AND lower((storage.foldername(name))[1]) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );

CREATE POLICY "personal-docs insert own"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'personal-documents'
    AND lower((storage.foldername(name))[1]) = lower(coalesce(auth.jwt() ->> 'email', ''))
    AND public.is_personal_dashboard_user()
  );

CREATE POLICY "personal-docs update own"
  ON storage.objects FOR UPDATE TO authenticated
  USING (
    bucket_id = 'personal-documents'
    AND lower((storage.foldername(name))[1]) = lower(coalesce(auth.jwt() ->> 'email', ''))
  )
  WITH CHECK (
    bucket_id = 'personal-documents'
    AND lower((storage.foldername(name))[1]) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );

CREATE POLICY "personal-docs delete own"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'personal-documents'
    AND lower((storage.foldername(name))[1]) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );

-- ── Daily reminder cron ─────────────────────────────────────────────────
-- Fires the personal-doc-reminder-cron edge function every day at 08:00 IST
-- (02:30 UTC). The edge function reads expiring docs and dispatches WA/email
-- per the user's notification prefs, using the dedupe table above.
CREATE OR REPLACE FUNCTION public.fn_invoke_personal_doc_reminders()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_supa_url    text;
  v_service_key text;
BEGIN
  SELECT value INTO v_supa_url    FROM public._app_config WHERE key = 'supabase_url';
  SELECT value INTO v_service_key FROM public._app_config WHERE key = 'service_role_key';
  IF v_supa_url IS NULL OR v_service_key IS NULL THEN RETURN; END IF;

  PERFORM net.http_post(
    url     := v_supa_url || '/functions/v1/personal-doc-reminder-cron',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || v_service_key
    ),
    body    := '{}'::jsonb
  );
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'fn_invoke_personal_doc_reminders failed: %', SQLERRM;
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'personal-doc-reminders') THEN
    PERFORM cron.unschedule('personal-doc-reminders');
  END IF;
  PERFORM cron.schedule(
    'personal-doc-reminders',
    '30 2 * * *',  -- 08:00 IST daily
    $cron$SELECT public.fn_invoke_personal_doc_reminders()$cron$
  );
END;
$$;
