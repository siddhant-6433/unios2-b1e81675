-- Token-fee deadline reminders.
--
-- After an offer is issued, the applicant has until offer.acceptance_deadline
-- to pay the token fee that holds their seat. This cron sends three
-- escalating WhatsApp nudges before that deadline:
--
--   • 2 days before     → milestone '2d'
--   • 1 day before      → milestone '1d'
--   • 4 hours before    → milestone '4h'
--
-- Each (offer_id, milestone) pair is recorded once in
-- token_fee_reminders_sent so a re-run can't double-send. The cron runs
-- hourly to give us the resolution we need for the 4-hour nudge.
--
-- Each tick POSTs notify-event with event='token_fee_reminder' — the
-- edge function picks the WhatsApp template, mints the magic pay link,
-- and dispatches the message.

CREATE TABLE IF NOT EXISTS public.token_fee_reminders_sent (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id   uuid NOT NULL REFERENCES public.offer_letters(id) ON DELETE CASCADE,
  lead_id    uuid NOT NULL REFERENCES public.leads(id)         ON DELETE CASCADE,
  milestone  text NOT NULL CHECK (milestone IN ('2d', '1d', '4h')),
  sent_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (offer_id, milestone)
);

ALTER TABLE public.token_fee_reminders_sent ENABLE ROW LEVEL SECURITY;

-- Staff-only read access via existing role checks (super_admin/admin
-- can audit reminder history); no public read.
DROP POLICY IF EXISTS "staff read token_fee_reminders_sent" ON public.token_fee_reminders_sent;
CREATE POLICY "staff read token_fee_reminders_sent"
  ON public.token_fee_reminders_sent FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid()
        AND role IN ('super_admin', 'admin', 'counsellor', 'team_leader')
    )
  );

CREATE OR REPLACE FUNCTION public.fn_send_token_fee_reminders()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r              record;
  v_supa_url     text;
  v_service_key  text;
  v_milestone    text;
  v_hours_left   numeric;
  v_status       jsonb;
  v_deadline_ts  timestamptz;
  v_now          timestamptz := now();
BEGIN
  SELECT value INTO v_supa_url    FROM public._app_config WHERE key = 'supabase_url';
  SELECT value INTO v_service_key FROM public._app_config WHERE key = 'service_role_key';
  IF v_supa_url IS NULL OR v_service_key IS NULL THEN RETURN; END IF;

  FOR r IN
    SELECT o.id                  AS offer_id,
           o.lead_id,
           o.acceptance_deadline,
           o.net_fee,
           o.token_fee_amount,
           l.name                AS lead_name,
           l.phone,
           l.stage
    FROM public.offer_letters o
    JOIN public.leads l ON l.id = o.lead_id
    WHERE o.approval_status = 'approved'
      AND o.acceptance_deadline IS NOT NULL
      AND l.phone IS NOT NULL
      AND l.stage <> 'dnc'
      -- prune obviously-finished leads early to avoid wasting a fee-status call
      AND l.pre_admission_no IS NULL
  LOOP
    -- Skip if the token is already paid (PAN issued may not have been
    -- recorded yet on rare timing — fee_status is authoritative).
    v_status := public.lead_fee_status(r.lead_id);
    IF (v_status->>'token_complete')::boolean THEN CONTINUE; END IF;

    -- Treat the acceptance_deadline date as end-of-day IST. The applicant
    -- has until 23:59 local time to pay.
    v_deadline_ts := ((r.acceptance_deadline + 1)::timestamp AT TIME ZONE 'Asia/Kolkata') - interval '1 second';
    v_hours_left  := EXTRACT(EPOCH FROM (v_deadline_ts - v_now)) / 3600.0;

    -- Out of window
    IF v_hours_left <= 0 OR v_hours_left > 72 THEN CONTINUE; END IF;

    -- Pick the most-urgent milestone we haven't sent yet for this offer.
    -- The check order matters: 4h first, then 1d, then 2d.
    IF v_hours_left <= 4 THEN
      v_milestone := '4h';
    ELSIF v_hours_left <= 24 THEN
      v_milestone := '1d';
    ELSIF v_hours_left <= 48 THEN
      v_milestone := '2d';
    ELSE
      CONTINUE;
    END IF;

    -- Idempotency — UNIQUE(offer_id, milestone) is the lock; ON CONFLICT
    -- DO NOTHING returns no row, so we can use FOUND to detect a dup and
    -- skip the http_post.
    INSERT INTO public.token_fee_reminders_sent (offer_id, lead_id, milestone)
    VALUES (r.offer_id, r.lead_id, v_milestone)
    ON CONFLICT (offer_id, milestone) DO NOTHING;
    IF NOT FOUND THEN CONTINUE; END IF;

    PERFORM net.http_post(
      url     := v_supa_url || '/functions/v1/notify-event',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer ' || v_service_key
      ),
      body    := jsonb_build_object(
        'event',   'token_fee_reminder',
        'lead_id', r.lead_id,
        'context', jsonb_build_object(
          'offer_id',  r.offer_id,
          'milestone', v_milestone
        )
      )
    );
  END LOOP;
EXCEPTION WHEN OTHERS THEN
  RAISE WARNING 'fn_send_token_fee_reminders failed: %', SQLERRM;
END;
$$;

-- Hourly tick is enough for 4h-granularity. Idempotency table guarantees
-- single delivery per (offer, milestone) regardless of how often we run.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'token-fee-reminders') THEN
    PERFORM cron.unschedule('token-fee-reminders');
  END IF;
  PERFORM cron.schedule(
    'token-fee-reminders',
    '0 * * * *',
    $cron$SELECT public.fn_send_token_fee_reminders()$cron$
  );
END;
$$;
