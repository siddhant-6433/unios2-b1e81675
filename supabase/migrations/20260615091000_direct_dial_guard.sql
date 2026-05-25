-- Soft direct-dial guard: when a counsellor opens a non-priority lead and
-- clicks Cloud Call, the UI checks counsellor_dial_guard(). If priority
-- work is pending, a modal lists the counts and asks them to clear those
-- first. They can still call anyway by providing a reason, which is
-- logged to direct_dial_overrides for coaching by TLs.
--
-- "Priority work" = unattempted paid (meta/google) new leads <24h old,
-- or followups overdue by >2h. "Exempt" leads = the lead being called
-- is itself priority work, so showing the modal would be friction.

CREATE TABLE IF NOT EXISTS public.direct_dial_overrides (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  counsellor_id          uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  lead_id                uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  reason                 text NOT NULL,
  paid_pending_count     integer NOT NULL DEFAULT 0,
  overdue_pending_count  integer NOT NULL DEFAULT 0,
  created_at             timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS direct_dial_overrides_counsellor_created_idx
  ON public.direct_dial_overrides (counsellor_id, created_at DESC);

ALTER TABLE public.direct_dial_overrides ENABLE ROW LEVEL SECURITY;

-- Counsellors can insert their own overrides.
DROP POLICY IF EXISTS direct_dial_overrides_self_insert ON public.direct_dial_overrides;
CREATE POLICY direct_dial_overrides_self_insert
  ON public.direct_dial_overrides FOR INSERT
  TO authenticated
  WITH CHECK (
    counsellor_id IN (SELECT id FROM public.profiles WHERE user_id = auth.uid())
  );

-- Counsellors can read their own overrides. TLs/admins can read all.
DROP POLICY IF EXISTS direct_dial_overrides_read ON public.direct_dial_overrides;
CREATE POLICY direct_dial_overrides_read
  ON public.direct_dial_overrides FOR SELECT
  TO authenticated
  USING (
    counsellor_id IN (SELECT id FROM public.profiles WHERE user_id = auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('super_admin','campus_admin','admission_head')
    )
    OR EXISTS (
      SELECT 1 FROM public.teams t WHERE t.leader_id = auth.uid()
    )
  );

-- counsellor_dial_guard: returns the pending counts (excluding the lead
-- the counsellor is about to call) and a flag indicating whether the
-- current lead is itself priority work.
CREATE OR REPLACE FUNCTION public.counsellor_dial_guard(
  p_counsellor_id uuid,
  p_lead_id       uuid
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  WITH
    paid AS (
      SELECT count(*)::int AS n
      FROM public.leads l
      WHERE l.counsellor_id = p_counsellor_id
        AND l.stage = 'new_lead'
        AND l.first_contact_at IS NULL
        AND l.source IN ('meta_ads','google_ads')
        AND l.created_at > now() - interval '24 hours'
        AND l.phone IS NOT NULL
        AND l.id <> p_lead_id
    ),
    overdue AS (
      SELECT count(*)::int AS n
      FROM public.overdue_followups ovr
      WHERE ovr.counsellor_id = p_counsellor_id
        AND ovr.lead_id <> p_lead_id
        AND ovr.scheduled_at < now() - interval '2 hours'
    ),
    -- Current lead is exempt from the guard if it's itself priority work:
    --   priority_interested stage, missed callback, paid-pending new lead,
    --   or has an overdue followup.
    current_exempt AS (
      SELECT
        (
          EXISTS (
            SELECT 1 FROM public.leads l
            WHERE l.id = p_lead_id AND l.stage = 'priority_interested'
          )
          OR EXISTS (
            SELECT 1 FROM public.ai_call_records acr
            WHERE acr.lead_id = p_lead_id
              AND acr.needs_followup = true
              AND acr.followup_done_at IS NULL
          )
          OR EXISTS (
            SELECT 1 FROM public.leads l
            WHERE l.id = p_lead_id
              AND l.stage = 'new_lead'
              AND l.first_contact_at IS NULL
              AND l.source IN ('meta_ads','google_ads')
              AND l.created_at > now() - interval '24 hours'
          )
          OR EXISTS (
            SELECT 1 FROM public.overdue_followups ovr
            WHERE ovr.lead_id = p_lead_id
          )
        ) AS exempt
    )
  SELECT jsonb_build_object(
    'paid_pending',         (SELECT n FROM paid),
    'overdue_pending',      (SELECT n FROM overdue),
    'current_lead_exempt',  (SELECT exempt FROM current_exempt)
  );
$$;

GRANT EXECUTE ON FUNCTION public.counsellor_dial_guard(uuid, uuid) TO authenticated;
