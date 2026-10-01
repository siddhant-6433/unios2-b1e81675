-- Hiring Phase D — AI resume parsing/ranking, Google Meet/Calendar, referrals.
--
-- Resume parsing/ranking stores a Gemini-derived structured profile + fit score.
-- Google Meet/Calendar links are stored on the interview (populated by the
-- interview-meet edge function when Google Workspace creds are configured,
-- otherwise it returns a Calendar template URL the UI can open).
-- Referrals let any employee put a candidate forward; converted referrals are
-- credited to the referrer.

-- ── 1. AI parse/rank fields on job_applicants ────────────────────────────────

ALTER TABLE public.job_applicants
  ADD COLUMN IF NOT EXISTS ai_rank_score   numeric(5,2),
  ADD COLUMN IF NOT EXISTS ai_summary      text,
  ADD COLUMN IF NOT EXISTS parsed_profile  jsonb,
  ADD COLUMN IF NOT EXISTS ai_parsed_at    timestamptz,
  ADD COLUMN IF NOT EXISTS ai_parse_error  text,
  ADD COLUMN IF NOT EXISTS referrer_user_id uuid REFERENCES auth.users(id);

CREATE INDEX IF NOT EXISTS job_applicants_rank_idx
  ON public.job_applicants (job_opening_id, ai_rank_score DESC NULLS LAST);

-- ── 2. Google Meet / Calendar fields on interviews ───────────────────────────

ALTER TABLE public.interviews
  ADD COLUMN IF NOT EXISTS meet_link          text,
  ADD COLUMN IF NOT EXISTS calendar_event_id  text,
  ADD COLUMN IF NOT EXISTS calendar_html_link text,
  ADD COLUMN IF NOT EXISTS interviewer_email  text;

-- ── 3. Referrals ─────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.job_referrals (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  applicant_id        uuid REFERENCES public.job_applicants(id) ON DELETE SET NULL,
  candidate_name      text NOT NULL,
  candidate_phone     text,
  candidate_email     text,
  job_opening_id      uuid REFERENCES public.job_openings(id) ON DELETE SET NULL,
  note                text,
  status              text NOT NULL DEFAULT 'invited'
                        CHECK (status IN ('invited', 'applied', 'hired', 'expired')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS job_referrals_referrer_idx ON public.job_referrals (referrer_user_id, created_at DESC);

ALTER TABLE public.job_referrals ENABLE ROW LEVEL SECURITY;

-- A referrer sees their own referrals; HR sees all.
DROP POLICY IF EXISTS "People read own referrals" ON public.job_referrals;
CREATE POLICY "People read own referrals"
  ON public.job_referrals FOR SELECT TO authenticated
  USING (
    referrer_user_id = auth.uid()
    OR (SELECT public.has_permission(auth.uid(), 'hr:view'))
    OR (SELECT public.has_permission(auth.uid(), 'hr:recruitment_edit'))
  );

DROP POLICY IF EXISTS "People create own referrals" ON public.job_referrals;
CREATE POLICY "People create own referrals"
  ON public.job_referrals FOR INSERT TO authenticated
  WITH CHECK (referrer_user_id = auth.uid());

DROP POLICY IF EXISTS "HR manages referrals" ON public.job_referrals;
CREATE POLICY "HR manages referrals"
  ON public.job_referrals FOR ALL TO authenticated
  USING ((SELECT public.has_permission(auth.uid(), 'hr:recruitment_edit')))
  WITH CHECK ((SELECT public.has_permission(auth.uid(), 'hr:recruitment_edit')));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.job_referrals TO authenticated;
GRANT ALL ON public.job_referrals TO service_role;

CREATE OR REPLACE FUNCTION public.tg_job_referrals_touch()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_job_referrals_touch ON public.job_referrals;
CREATE TRIGGER trg_job_referrals_touch
  BEFORE UPDATE ON public.job_referrals
  FOR EACH ROW EXECUTE FUNCTION public.tg_job_referrals_touch();

-- Referrer summary (their count by status).
CREATE OR REPLACE FUNCTION public.job_referral_summary()
RETURNS TABLE (referrer_user_id uuid, referrer_name text, total bigint, applied bigint, hired bigint)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT r.referrer_user_id,
         COALESCE(prof.display_name, 'Unknown'),
         count(*)::bigint,
         count(*) FILTER (WHERE r.status IN ('applied', 'hired'))::bigint,
         count(*) FILTER (WHERE r.status = 'hired')::bigint
    FROM public.job_referrals r
    LEFT JOIN public.profiles prof ON prof.user_id = r.referrer_user_id
   WHERE (SELECT public.has_permission(auth.uid(), 'hr:view'))
      OR r.referrer_user_id = auth.uid()
   GROUP BY r.referrer_user_id, prof.display_name
   ORDER BY 3 DESC;
$$;

REVOKE EXECUTE ON FUNCTION public.job_referral_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.job_referral_summary() TO authenticated, service_role;

-- ── 4. Ranking RPC ───────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.rank_job_applicants(_job_opening_id uuid DEFAULT NULL)
RETURNS TABLE (
  id uuid, name text, status text, ai_rank_score numeric, ai_summary text,
  desired_role text, job_opening_id uuid, job_opening_title text, resume_url text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ja.id, ja.name, ja.status, ja.ai_rank_score, ja.ai_summary,
         ja.desired_role, ja.job_opening_id, jo.title, ja.resume_url
    FROM public.job_applicants ja
    LEFT JOIN public.job_openings jo ON jo.id = ja.job_opening_id
   WHERE (
       (SELECT public.has_permission(auth.uid(), 'hr:view'))
       OR (SELECT public.has_permission(auth.uid(), 'hr:recruitment_edit'))
     )
     AND (_job_opening_id IS NULL OR ja.job_opening_id = _job_opening_id)
     AND ja.status NOT IN ('rejected', 'withdrawn')
   ORDER BY ja.ai_rank_score DESC NULLS LAST, ja.created_at DESC
   LIMIT 200;
$$;

REVOKE EXECUTE ON FUNCTION public.rank_job_applicants(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rank_job_applicants(uuid) TO authenticated, service_role;

-- ── 5. Surface AI fields + referrer in the inbox view ────────────────────────

DROP VIEW IF EXISTS public.job_applicants_inbox;
CREATE VIEW public.job_applicants_inbox AS -- lint-allow: HR-only inbox; LEFT JOIN to leads only nulls l.email for roles without leads RLS, never drops rows
SELECT
  ja.id, ja.lead_id, ja.status, ja.name, ja.source_phone AS phone,
  ja.desired_role, ja.experience_years, ja.resume_url,
  ja.classification_source, ja.ai_intent, ja.ai_confidence, ja.ai_reasoning,
  ja.assigned_to, ja.notes, ja.rating, ja.stage_changed_at,
  ja.job_opening_id, ja.applied_via, ja.cover_note, ja.source_channel, ja.source_message_id,
  ja.ai_rank_score, ja.ai_summary, ja.parsed_profile,
  ja.referrer_user_id,
  ja.first_message_at, ja.last_message_at, ja.created_at, ja.updated_at,
  COALESCE(ja.email, l.email) AS email,
  l.source AS lead_source,
  jo.title AS job_opening_title,
  (SELECT content FROM public.whatsapp_messages wm
     WHERE wm.lead_id = ja.lead_id AND wm.direction='inbound'
     ORDER BY wm.created_at DESC LIMIT 1) AS last_message_preview,
  (SELECT count(*) FROM public.whatsapp_messages wm
     WHERE wm.lead_id = ja.lead_id AND wm.direction='inbound') AS inbound_message_count,
  prof.display_name AS assigned_to_name,
  ref.display_name  AS referrer_name
FROM public.job_applicants ja
LEFT JOIN public.leads l         ON l.id = ja.lead_id
LEFT JOIN public.job_openings jo ON jo.id = ja.job_opening_id
LEFT JOIN public.profiles prof   ON prof.user_id = ja.assigned_to
LEFT JOIN public.profiles ref    ON ref.user_id = ja.referrer_user_id;

ALTER VIEW public.job_applicants_inbox SET (security_invoker = true);
GRANT SELECT ON public.job_applicants_inbox TO authenticated;
