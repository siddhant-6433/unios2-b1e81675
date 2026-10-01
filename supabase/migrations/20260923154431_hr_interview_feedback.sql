-- Recruitment: interview feedback.
--
-- There are two interview models in the schema. The UI schedules interviews in
-- `interviews` (single interviewer, notified via WhatsApp), while
-- `interview_rounds` + `interview_feedback` were added for panel interviews but
-- never wired to a screen. Rather than build a third path, this extends the model
-- the UI already uses with feedback and marks the unused pair deprecated.

ALTER TABLE public.interviews
  ADD COLUMN IF NOT EXISTS panel uuid[] DEFAULT '{}'::uuid[],
  ADD COLUMN IF NOT EXISTS duration_mins smallint DEFAULT 30,
  ADD COLUMN IF NOT EXISTS rating smallint CHECK (rating IS NULL OR (rating BETWEEN 1 AND 5)),
  ADD COLUMN IF NOT EXISTS recommend text CHECK (recommend IS NULL OR recommend IN ('strong_yes', 'yes', 'no', 'strong_no')),
  ADD COLUMN IF NOT EXISTS feedback_notes text,
  ADD COLUMN IF NOT EXISTS feedback_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS feedback_at timestamptz;

COMMENT ON TABLE public.interview_rounds IS
  'Deprecated: use public.interviews + its feedback columns. Kept only so existing rows are not lost.';
COMMENT ON TABLE public.interview_feedback IS
  'Deprecated: use public.interviews feedback columns. Kept only so existing rows are not lost.';

CREATE INDEX IF NOT EXISTS idx_interviews_feedback ON public.interviews (job_applicant_id)
  WHERE feedback_at IS NOT NULL;

-- Record a decision on a scheduled interview and mark it completed.
CREATE OR REPLACE FUNCTION public.record_interview_feedback(
  _interview_id uuid, _rating smallint DEFAULT NULL, _recommend text DEFAULT NULL,
  _notes text DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_applicant uuid; v_by uuid;
BEGIN
  IF NOT (public.has_permission(auth.uid(), 'hr:interviews_edit')
          OR public.has_permission(auth.uid(), 'hr:recruitment_edit')
          OR public.has_role(auth.uid(), 'super_admin'::public.app_role)) THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  SELECT job_applicant_id INTO v_applicant FROM public.interviews WHERE id = _interview_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Interview not found'; END IF;

  UPDATE public.interviews
     SET rating = _rating,
         recommend = _recommend,
         feedback_notes = _notes,
         feedback_by = auth.uid(),
         feedback_at = now(),
         status = 'completed'
   WHERE id = _interview_id;

  -- Audit against the applicant so the pipeline shows the decision.
  INSERT INTO public.job_applicant_activities (applicant_id, user_id, type, description)
  VALUES (
    v_applicant, auth.uid(), 'interview_feedback',
    'Interview feedback recorded' ||
      COALESCE(' · ' || _recommend, '') ||
      CASE WHEN _rating IS NOT NULL THEN ' · ' || _rating || '/5' ELSE '' END
  );

  RETURN 'completed';
END;
$$;

REVOKE EXECUTE ON FUNCTION public.record_interview_feedback(uuid, smallint, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.record_interview_feedback(uuid, smallint, text, text) TO authenticated, service_role;
