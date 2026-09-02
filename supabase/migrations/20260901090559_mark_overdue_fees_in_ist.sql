-- Flip the Overdue badge on the IST calendar too, matching
-- 20260901085850_late_fee_dates_in_ist.
--
-- fn_mark_overdue_fees compared due_date + grace against CURRENT_DATE, which in
-- this UTC database is the UTC calendar day. A row therefore became Overdue at
-- 05:30 IST rather than at Indian midnight. No rupee amount depends on this --
-- the late fine is computed by fn_recompute_late_fees, which is already on IST
-- -- but the status the counter and the student portal read should turn over
-- with the Indian day. Grace-period arithmetic is unchanged.

CREATE OR REPLACE FUNCTION public.fn_mark_overdue_fees()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  -- Rows linked to a fee structure with an active policy: use configured grace period
  UPDATE fee_ledger fl
  SET    status = 'overdue'
  FROM   fee_structure_items fsi
  JOIN   late_fee_policies    lfp
      ON lfp.fee_structure_id = fsi.fee_structure_id
     AND lfp.is_active = true
  WHERE  fl.fee_structure_item_id = fsi.id
    AND  fl.status = 'due'
    AND  fl.balance > 0
    AND  fl.due_date + (lfp.grace_period_days * INTERVAL '1 day') < (now() AT TIME ZONE 'Asia/Kolkata')::date;

  -- All other due rows: default 7-day grace period
  UPDATE fee_ledger fl
  SET    status = 'overdue'
  WHERE  fl.status = 'due'
    AND  fl.balance > 0
    AND  fl.due_date + INTERVAL '7 days' < (now() AT TIME ZONE 'Asia/Kolkata')::date
    AND  (
           fl.fee_structure_item_id IS NULL
           OR NOT EXISTS (
             SELECT 1
             FROM   fee_structure_items fsi2
             JOIN   late_fee_policies   lfp2
                 ON lfp2.fee_structure_id = fsi2.fee_structure_id
                AND lfp2.is_active = true
             WHERE  fsi2.id = fl.fee_structure_item_id
           )
         );
END;
$function$;
