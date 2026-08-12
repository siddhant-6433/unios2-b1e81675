-- Live counselling updates: Navya's knowledge base goes stale between rounds
-- (CAHET / CNET / UPGET dates change weekly on the ABVMU portal). A cron
-- scrapes each source page, and the summary is injected into the AI reply
-- context so Navya answers "which round is on / what's the deadline" from the
-- official site instead of a hand-maintained knowledge file.

CREATE TABLE IF NOT EXISTS public.counselling_sources (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_key    text NOT NULL UNIQUE,
  label         text NOT NULL,
  url           text NOT NULL,
  scope         text,                       -- which exams/courses this page covers
  is_active     boolean NOT NULL DEFAULT true,
  content_hash  text,
  summary       text,                       -- LLM brief: current round + deadlines
  fetched_at    timestamptz,
  changed_at    timestamptz,
  last_error    text,
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.counselling_sources ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff read counselling sources" ON public.counselling_sources;
CREATE POLICY "staff read counselling sources"
  ON public.counselling_sources FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "admins manage counselling sources" ON public.counselling_sources;
CREATE POLICY "admins manage counselling sources"
  ON public.counselling_sources FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

GRANT SELECT ON public.counselling_sources TO authenticated;
GRANT ALL ON public.counselling_sources TO service_role;

INSERT INTO public.counselling_sources (source_key, label, url, scope)
VALUES
  (
    'abvmu',
    'ABVMU Lucknow entrance counselling portal',
    'https://www.abvmucet26.co.in/',
    'CAHET (BPT, BMRIT, allied healthcare UG/PG), CNET (B.Sc Nursing, Post Basic B.Sc, M.Sc Nursing), UPGET (GNM)'
  ),
  (
    'jeecup',
    'JEECUP (UP Polytechnic) admissions and eCounselling portal',
    'https://jeecup.admissions.nic.in/',
    'JEECUP counselling for D.Pharma and other UP polytechnic diploma courses — rounds, seat allotment, fee deposit, document verification'
  )
ON CONFLICT (source_key) DO NOTHING;

-- Twice daily at 07:00 and 15:00 IST (01:30 / 09:30 UTC) — round notices move
-- by the day, not the hour.
SELECT cron.unschedule('counselling-watch')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'counselling-watch');

SELECT cron.schedule(
  'counselling-watch',
  '30 1,9 * * *',
  $$
  SELECT net.http_post(
    url     := (SELECT value FROM public._app_config WHERE key = 'supabase_url')
               || '/functions/v1/counselling-watch',
    headers := jsonb_build_object(
      'Content-Type',  'application/json',
      'Authorization', 'Bearer ' || (SELECT value FROM public._app_config WHERE key = 'service_role_key')
    ),
    body    := '{}'::jsonb
  )
  $$
);
