-- Per-user pinned leads for the Cloud Dialer queue.
--
-- The Cloud Dialer's queue is computed from several source tables (followups,
-- visits, priority_interested, etc.). Counsellors also want to manually push
-- a specific lead to the top — e.g. when they spot a hot lead on the lead
-- page and want to dial it next. This table stores those manual pins.
--
-- One row per (user, lead) pair. CloudDialer.loadQueue reads pins for the
-- current user and prepends them at bucket "pinned" so they show first.
-- Pins are removed automatically when the lead is dialed and dispositioned,
-- via a trigger on call_logs (see below).

CREATE TABLE IF NOT EXISTS public.cloud_dialer_pins (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  lead_id     uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, lead_id)
);

CREATE INDEX IF NOT EXISTS idx_cloud_dialer_pins_user_created
  ON public.cloud_dialer_pins (user_id, created_at DESC);

ALTER TABLE public.cloud_dialer_pins ENABLE ROW LEVEL SECURITY;

-- Owner-scoped: each user only sees and manages their own pins.
CREATE POLICY "users manage own dialer pins"
  ON public.cloud_dialer_pins
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

GRANT SELECT, INSERT, DELETE ON public.cloud_dialer_pins TO authenticated;

-- Auto-remove the pin once the user has actually called the lead from the
-- dialer. We hook call_logs since it's the canonical "this call happened"
-- table for both AI and manual paths.
CREATE OR REPLACE FUNCTION public.fn_cleanup_cloud_dialer_pin()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.user_id IS NOT NULL AND NEW.lead_id IS NOT NULL THEN
    DELETE FROM public.cloud_dialer_pins
     WHERE user_id = NEW.user_id AND lead_id = NEW.lead_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cleanup_cloud_dialer_pin ON public.call_logs;
CREATE TRIGGER trg_cleanup_cloud_dialer_pin
  AFTER INSERT ON public.call_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_cleanup_cloud_dialer_pin();

COMMENT ON TABLE public.cloud_dialer_pins IS
  'Manual per-user pins that float specific leads to the top of the Cloud Dialer queue. Auto-cleared on first call_logs insert for that (user, lead) pair.';
