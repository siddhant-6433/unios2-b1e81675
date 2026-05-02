-- Drafts for the Add Student dialog. Long form, staff don't always finish in one
-- sitting. Auto-saved to this table; the user (and optionally admins) can resume
-- a draft from a Drafts panel on the Students page.
--
-- Design notes:
-- * `data` jsonb stores the full form state — schema can evolve without migrations.
-- * `display_name` / `campus_name` / `course_name` are denormalised for the
--   drafts list so we don't need joins to render the panel.
-- * `completed_at` is set when the draft is promoted to a real student row;
--   list view filters on completed_at IS NULL.

CREATE TABLE IF NOT EXISTS public.student_drafts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by    UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  data          JSONB NOT NULL DEFAULT '{}'::jsonb,
  display_name  TEXT,
  campus_name   TEXT,
  course_name   TEXT,
  step          INTEGER NOT NULL DEFAULT 0,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_student_drafts_active
  ON public.student_drafts(created_by, updated_at DESC)
  WHERE completed_at IS NULL;

ALTER TABLE public.student_drafts ENABLE ROW LEVEL SECURITY;

-- Owners always see and manage their own drafts.
CREATE POLICY "users manage own student drafts"
  ON public.student_drafts
  FOR ALL
  USING (auth.uid() = created_by)
  WITH CHECK (auth.uid() = created_by);

-- Admins / principals can review everyone's drafts (read-only).
CREATE POLICY "admins read all student drafts"
  ON public.student_drafts
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('super_admin', 'campus_admin', 'principal', 'admission_head')
    )
  );

CREATE OR REPLACE FUNCTION public.touch_student_draft_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_touch_student_draft ON public.student_drafts;
CREATE TRIGGER trg_touch_student_draft
  BEFORE UPDATE ON public.student_drafts
  FOR EACH ROW EXECUTE FUNCTION public.touch_student_draft_updated_at();
