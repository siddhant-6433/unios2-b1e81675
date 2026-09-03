-- Date-scope the Finance Engine "Total Collected" card.
--
-- The four summary cards were all cumulative. Collections are a *flow* keyed on
-- payment date, so "Total Collected" should honour a date range; Due / Overdue /
-- Concession remain current "as of now" balance snapshots.
--
-- Source rule:
--   * Range = NULL (All time)  -> collected/paid_items from fee_ledger (unchanged).
--     Imported opening balances have paid_amount but no payment row, so the
--     lifetime figure must stay ledger-sourced or it would drop.
--   * Range given             -> collected/paid_items from v_all_payments (the
--     confirmed lead_payments + payments union) by payment date, IST day.
--
-- Signature changes 1 arg -> 3 args, so drop the old overload first.

DROP FUNCTION IF EXISTS public.finance_summary(uuid[]);

CREATE OR REPLACE FUNCTION public.finance_summary(
  _campus_ids uuid[] DEFAULT NULL,
  _from date DEFAULT NULL,
  _to   date DEFAULT NULL
)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH snap AS (   -- cumulative snapshot, campus-scoped, role-gated (unchanged)
    SELECT
      COALESCE(SUM(fl.total_amount),0)                                  AS total_fee,
      COALESCE(SUM(fl.paid_amount),0)                                   AS collected_all,
      COALESCE(SUM(fl.concession),0)                                    AS concession,
      COALESCE(SUM(fl.balance),0)                                       AS due,
      COALESCE(SUM(fl.balance) FILTER (WHERE fl.status='overdue'),0)    AS overdue,
      COUNT(*) FILTER (WHERE fl.status='paid')                          AS paid_items_all,
      COUNT(*)                                                          AS total_items
    FROM public.fee_ledger fl
    JOIN public.students s ON s.id = fl.student_id
    WHERE ( public.has_role(auth.uid(),'super_admin')
         OR public.has_role(auth.uid(),'campus_admin')
         OR public.has_role(auth.uid(),'principal')
         OR public.has_role(auth.uid(),'accountant') )
      AND (_campus_ids IS NULL OR s.campus_id = ANY(_campus_ids))
  ),
  flow AS (        -- date-scoped collections from actual payment rows
    SELECT
      COALESCE(SUM(vp.amount),0) AS collected_range,
      COUNT(*)                   AS paid_items_range
    FROM public.v_all_payments vp
    WHERE ( public.has_role(auth.uid(),'super_admin')
         OR public.has_role(auth.uid(),'campus_admin')
         OR public.has_role(auth.uid(),'principal')
         OR public.has_role(auth.uid(),'accountant') )
      AND (_campus_ids IS NULL OR vp.campus_id = ANY(_campus_ids))
      AND (_from IS NULL OR (vp.paid_at AT TIME ZONE 'Asia/Kolkata')::date >= _from)
      AND (_to   IS NULL OR (vp.paid_at AT TIME ZONE 'Asia/Kolkata')::date <= _to)
  )
  SELECT jsonb_build_object(
    'total_fee',   snap.total_fee,
    'collected',   CASE WHEN _from IS NULL AND _to IS NULL THEN snap.collected_all  ELSE flow.collected_range END,
    'concession',  snap.concession,
    'due',         snap.due,
    'overdue',     snap.overdue,
    'paid_items',  CASE WHEN _from IS NULL AND _to IS NULL THEN snap.paid_items_all ELSE flow.paid_items_range END,
    'total_items', snap.total_items
  )
  FROM snap, flow;
$$;

GRANT EXECUTE ON FUNCTION public.finance_summary(uuid[], date, date) TO authenticated, service_role;
