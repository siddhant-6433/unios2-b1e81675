-- 1. Marketing-fatigue suppression -------------------------------------------
--
-- Meta caps marketing templates at roughly two per user per 24h ACROSS ALL
-- businesses. When we exceed it we get 131049, and re-sending inside the window
-- both fails and feeds the block/report signal that caused the cap. Meta's
-- guidance is to stop targeting recipients who repeatedly hit it.
--
-- Keyed by phone rather than lead/contact id so one row covers a person however
-- they are represented — `leads`, `marketing_contacts`, or both. Nothing else
-- needs a schema change.

CREATE TABLE IF NOT EXISTS public.whatsapp_send_suppression (
  phone       text PRIMARY KEY,
  reason      text NOT NULL DEFAULT 'marketing_fatigue',
  strikes     integer NOT NULL DEFAULT 1,
  until       timestamptz,
  last_code   text,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Suppression lookups are always "is this phone currently suppressed".
CREATE INDEX IF NOT EXISTS idx_wa_suppression_active
  ON public.whatsapp_send_suppression (phone)
  WHERE until IS NOT NULL;

ALTER TABLE public.whatsapp_send_suppression ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff read suppression" ON public.whatsapp_send_suppression;
CREATE POLICY "staff read suppression" ON public.whatsapp_send_suppression
  FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid()));

GRANT SELECT ON public.whatsapp_send_suppression TO authenticated;
GRANT ALL ON public.whatsapp_send_suppression TO service_role;

-- Digits-only comparison: recipient phones are stored inconsistently
-- ("+918800972524", "918800972524", "8800972524"), so normalise on both sides.
CREATE OR REPLACE FUNCTION public.wa_normalize_phone(_phone text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT regexp_replace(coalesce(_phone, ''), '[^0-9]', '', 'g');
$$;

-- Record a fatigue strike; suppress for 7 days once a number hits _threshold.
CREATE OR REPLACE FUNCTION public.record_wa_send_strike(
  _phone text,
  _code text DEFAULT '131049',
  _threshold integer DEFAULT 2
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_phone   text := public.wa_normalize_phone(_phone);
  v_strikes integer;
BEGIN
  IF v_phone = '' THEN RETURN 0; END IF;

  INSERT INTO public.whatsapp_send_suppression AS s (phone, reason, strikes, last_code, updated_at)
  VALUES (v_phone, 'marketing_fatigue', 1, _code, now())
  ON CONFLICT (phone) DO UPDATE
     SET strikes    = s.strikes + 1,
         last_code  = EXCLUDED.last_code,
         updated_at = now()
  RETURNING strikes INTO v_strikes;

  IF v_strikes >= _threshold THEN
    UPDATE public.whatsapp_send_suppression
       SET until = now() + interval '7 days'
     WHERE phone = v_phone;
  END IF;

  RETURN v_strikes;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_wa_send_strike(text, text, integer) TO service_role;

-- Which of these phones are currently suppressed. Used by the campaign builder
-- to exclude them up front and show an accurate audience preview.
CREATE OR REPLACE FUNCTION public.wa_suppressed_phones(_phones text[])
RETURNS TABLE(phone text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT s.phone
    FROM public.whatsapp_send_suppression s
   WHERE s.until IS NOT NULL
     AND s.until > now()
     AND s.phone = ANY (SELECT public.wa_normalize_phone(p) FROM unnest(_phones) p);
$$;

GRANT EXECUTE ON FUNCTION public.wa_suppressed_phones(text[]) TO authenticated, service_role;

-- 2. Failure-reason breakdown -------------------------------------------------
--
-- The campaigns table shows a single red "504 failed" with no reason. Every
-- recipient already carries last_error_code (populated since 20260826144227,
-- never once read by the app). Grouping it turns that number into an action:
-- 402 billing / 98 unreachable / 4 daily cap are three different problems.

CREATE OR REPLACE FUNCTION public.campaign_failure_breakdown(p_campaign_ids uuid[])
RETURNS TABLE(campaign_id uuid, error_code text, failures bigint, sample_message text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT r.campaign_id,
         coalesce(r.last_error_code, 'unknown') AS error_code,
         count(*)                               AS failures,
         min(r.error_message)                   AS sample_message
    FROM public.whatsapp_campaign_recipients r
   WHERE r.campaign_id = ANY(p_campaign_ids)
     AND r.status IN ('failed', 'skipped')
   GROUP BY r.campaign_id, coalesce(r.last_error_code, 'unknown');
$$;

GRANT EXECUTE ON FUNCTION public.campaign_failure_breakdown(uuid[]) TO authenticated, service_role;

-- 3. Per-number health from Meta ----------------------------------------------
-- quality_rating (GREEN/YELLOW/RED) and the 24h messaging tier drive how much
-- we can safely send. Synced by whatsapp-channel-profiles-sync.

ALTER TABLE public.whatsapp_channels
  ADD COLUMN IF NOT EXISTS quality_rating text,
  ADD COLUMN IF NOT EXISTS messaging_limit_tier text,
  ADD COLUMN IF NOT EXISTS health_synced_at timestamptz;
