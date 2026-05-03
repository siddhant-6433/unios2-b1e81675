-- Audit log for every GA4 Measurement Protocol event the ga-conversions
-- relay attempts to send. Lets us debug missing conversions in GA without
-- combing through edge function logs (GA's MP endpoint always returns 204
-- with no body, even when payloads are silently dropped — auditing
-- locally is the only way to verify delivery).
--
-- Retention: keep ~90 days. A separate cron can prune older rows.

CREATE TABLE IF NOT EXISTS public.ga_event_log (
  id              bigserial PRIMARY KEY,
  lead_id         uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  event_name      text NOT NULL,
  value           numeric(12,2),
  transaction_id  text,
  measurement_id  text,
  ga_status       int,
  error_message   text,
  payload         jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ga_event_log_lead_idx
  ON public.ga_event_log (lead_id, created_at DESC);

CREATE INDEX IF NOT EXISTS ga_event_log_event_idx
  ON public.ga_event_log (event_name, created_at DESC);

ALTER TABLE public.ga_event_log ENABLE ROW LEVEL SECURITY;

-- Only super_admin can read. Service role (used by the relay + triggers)
-- bypasses RLS automatically.
CREATE POLICY "super_admin reads ga_event_log" ON public.ga_event_log
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'super_admin'));
