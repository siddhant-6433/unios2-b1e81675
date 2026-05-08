-- ====================================================================
-- Fix: paid-application leads in counsellor_call / visit_scheduled /
-- interview / etc. don't surface under "Fee Paid" buckets.
--
-- Existing sync_lead_stage_on_payment() advances lead.stage only when
-- the lead is in ('new_lead', 'application_in_progress'). For most
-- candidates, by the time they pay the application fee the lead has
-- already been touched by a counsellor (stage = counsellor_call /
-- visit_scheduled / etc.), so the stage never advances to
-- application_fee_paid. Result: dashboards across the app
-- (CounsellorDashboard, Admissions, LeadBuckets, ConsultantPortal,
-- WhatsAppInbox, AutomationRules, ...) which all key off lead.stage =
-- 'application_fee_paid' never see these candidates in the Fee Paid
-- bucket.
--
-- Broaden the trigger to advance from any pre-fee-paid stage, and
-- backfill existing leads that should have moved.
-- ====================================================================

CREATE OR REPLACE FUNCTION public.sync_lead_stage_on_payment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.payment_status = 'paid'
     AND (OLD.payment_status IS DISTINCT FROM 'paid')
     AND NEW.lead_id IS NOT NULL
  THEN
    -- Advance from any stage that comes BEFORE application_fee_paid in
    -- the admissions funnel. Stages already past fee (offer_sent /
    -- token_paid / admitted / etc.) and terminal stages (rejected /
    -- not_interested / dnc / waitlisted / ineligible / deferred) are
    -- left alone.
    UPDATE public.leads
       SET stage = 'application_fee_paid'
     WHERE id = NEW.lead_id
       AND stage IN (
         'new_lead',
         'application_in_progress',
         'application_submitted',
         'ai_called',
         'counsellor_call',
         'visit_scheduled',
         'priority_interested',
         'interview'
       );
  END IF;
  RETURN NEW;
END;
$$;

-- ────────── Backfill: leads with paid app but stale stage ──────────
DO $$
DECLARE
  v_updated int;
BEGIN
  UPDATE public.leads l
     SET stage = 'application_fee_paid'
   WHERE l.stage IN (
           'new_lead',
           'application_in_progress',
           'application_submitted',
           'ai_called',
           'counsellor_call',
           'visit_scheduled',
           'priority_interested',
           'interview'
         )
     AND EXISTS (
       SELECT 1 FROM public.applications a
        WHERE a.lead_id = l.id AND a.payment_status = 'paid'
     );
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RAISE NOTICE '[advance-fee-paid-backfill] advanced % leads to application_fee_paid', v_updated;
END $$;
