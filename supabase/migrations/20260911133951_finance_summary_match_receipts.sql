-- Finance header "Total Collected" and Receipts "Today's Collections" were
-- summing the same view with different day windows and filters, so one card
-- could show ₹0.5L / 10 payments while the other showed ₹104.8K / 11 txns.
-- Align the RPC with the receipts list: IST half-open day, include unresolved
-- campus rows, drop consultant credit notes from collection totals, and let
-- office_admin (the cashier) read the same snapshot.

CREATE OR REPLACE FUNCTION public.finance_summary(
  _campus_ids uuid[] DEFAULT NULL,
  _from date DEFAULT NULL,
  _to   date DEFAULT NULL
)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH snap AS (
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
         OR public.has_role(auth.uid(),'accountant')
         OR public.has_role(auth.uid(),'office_admin') )
      AND (_campus_ids IS NULL OR s.campus_id = ANY(_campus_ids))
  ),
  flow AS (
    SELECT
      COALESCE(SUM(vp.amount),0) AS collected_range,
      COUNT(*)                   AS paid_items_range
    FROM public.v_all_payments vp
    WHERE ( public.has_role(auth.uid(),'super_admin')
         OR public.has_role(auth.uid(),'campus_admin')
         OR public.has_role(auth.uid(),'principal')
         OR public.has_role(auth.uid(),'accountant')
         OR public.has_role(auth.uid(),'office_admin') )
      AND (
        _campus_ids IS NULL
        OR vp.campus_id IS NULL
        OR vp.campus_id = ANY(_campus_ids)
      )
      AND vp.payment_mode IS DISTINCT FROM 'consultant_credit_note'
      AND (_from IS NULL OR vp.paid_at >= (_from::timestamp AT TIME ZONE 'Asia/Kolkata'))
      AND (_to   IS NULL OR vp.paid_at <  ((_to + 1)::timestamp AT TIME ZONE 'Asia/Kolkata'))
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

NOTIFY pgrst, 'reload schema';
