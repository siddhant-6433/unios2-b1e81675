-- Schema for the missing pieces of the application → admission workflow:
--   1. application_doc_reviews — per-file verification status so admins can
--      explicitly approve/reject each uploaded document.
--   2. applications.approval_* columns — outcome of admin review.
--   3. lead_stage 'application_approved' — explicit step between
--      'application_fee_paid' and 'token_paid' so the funnel surfaces it.
--   4. student_magic_tokens — one-time login tokens generated at AN issuance
--      so the student can claim StudentPortal access.
--   5. lead_drafts — autosave for AddLeadDialog (mirrors student_drafts).
--
-- AN gating logic (applications must be approved before 25%-fee threshold
-- triggers AN issuance) lives in the next migration alongside the trigger
-- function changes.

------------------------------------------------------------------------
-- 1. application_doc_reviews
------------------------------------------------------------------------
-- Files live only in the `application-documents` storage bucket; there's
-- no app-side metadata table. We key reviews by (application_id, file_path)
-- which is the canonical identifier for an uploaded doc.

CREATE TABLE IF NOT EXISTS public.application_doc_reviews (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id  text NOT NULL,
  file_path       text NOT NULL,
  status          text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending', 'verified', 'rejected')),
  notes           text,
  reviewed_by     uuid REFERENCES public.profiles(id),
  reviewed_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (application_id, file_path)
);

CREATE INDEX IF NOT EXISTS idx_app_doc_reviews_app
  ON public.application_doc_reviews (application_id);

ALTER TABLE public.application_doc_reviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff manage app doc reviews"
  ON public.application_doc_reviews
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('super_admin', 'campus_admin', 'principal',
                        'admission_head', 'counsellor', 'office_admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('super_admin', 'campus_admin', 'principal',
                        'admission_head', 'counsellor', 'office_admin')
    )
  );

CREATE OR REPLACE FUNCTION public.touch_app_doc_review_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_app_doc_review ON public.application_doc_reviews;
CREATE TRIGGER trg_touch_app_doc_review
  BEFORE UPDATE ON public.application_doc_reviews
  FOR EACH ROW EXECUTE FUNCTION public.touch_app_doc_review_updated_at();

------------------------------------------------------------------------
-- 2. applications.approval_* columns
------------------------------------------------------------------------

ALTER TABLE public.applications
  ADD COLUMN IF NOT EXISTS approved_at        timestamptz,
  ADD COLUMN IF NOT EXISTS approved_by        uuid REFERENCES public.profiles(id),
  ADD COLUMN IF NOT EXISTS approval_notes     text,
  ADD COLUMN IF NOT EXISTS rejection_reason   text;

COMMENT ON COLUMN public.applications.approved_at IS
  'Set when admin approves the application — gates AN issuance via lead_payments trigger.';

------------------------------------------------------------------------
-- 3. lead_stage: add 'application_approved'
------------------------------------------------------------------------
-- Inserted between application_fee_paid and existing offer flow so the
-- funnel makes the human-checkpoint visible.

ALTER TYPE public.lead_stage ADD VALUE IF NOT EXISTS 'application_approved';

------------------------------------------------------------------------
-- 4. student_magic_tokens
------------------------------------------------------------------------
-- Generated on AN issuance. Single-use: redeem flips claimed_at and
-- creates/links the auth user → students.user_id.

CREATE TABLE IF NOT EXISTS public.student_magic_tokens (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token        text NOT NULL UNIQUE DEFAULT replace(gen_random_uuid()::text, '-', ''),
  student_id   uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  lead_id      uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  phone        text,
  email        text,
  expires_at   timestamptz NOT NULL,
  claimed_at   timestamptz,
  claimed_user_id uuid REFERENCES auth.users(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_student_magic_tokens_student
  ON public.student_magic_tokens (student_id);

CREATE INDEX IF NOT EXISTS idx_student_magic_tokens_active
  ON public.student_magic_tokens (token)
  WHERE claimed_at IS NULL;

ALTER TABLE public.student_magic_tokens ENABLE ROW LEVEL SECURITY;
-- No client-side policies — token redemption goes through an edge function
-- with service role. Reads are restricted to the audit trail in StudentPortal.
GRANT SELECT, INSERT, UPDATE ON public.student_magic_tokens TO service_role;

------------------------------------------------------------------------
-- 5. lead_drafts (mirror student_drafts)
------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.lead_drafts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  data          jsonb NOT NULL DEFAULT '{}'::jsonb,
  display_name  text,
  phone         text,
  course_name   text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  completed_at  timestamptz
);

CREATE INDEX IF NOT EXISTS idx_lead_drafts_active
  ON public.lead_drafts (created_by, updated_at DESC)
  WHERE completed_at IS NULL;

ALTER TABLE public.lead_drafts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users manage own lead drafts"
  ON public.lead_drafts
  FOR ALL TO authenticated
  USING (auth.uid() = created_by)
  WITH CHECK (auth.uid() = created_by);

CREATE OR REPLACE FUNCTION public.touch_lead_draft_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_lead_draft ON public.lead_drafts;
CREATE TRIGGER trg_touch_lead_draft
  BEFORE UPDATE ON public.lead_drafts
  FOR EACH ROW EXECUTE FUNCTION public.touch_lead_draft_updated_at();
