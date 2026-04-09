-- Add DELETE policies on all tables that CASCADE from leads
-- so super_admin can delete leads without RLS blocking cascades

DO $$
DECLARE
  tbl text;
BEGIN
  FOR tbl IN
    SELECT unnest(ARRAY[
      'lead_activities', 'lead_followups', 'lead_notes', 'lead_counsellors',
      'lead_documents', 'lead_payments', 'lead_merges', 'lead_deletion_requests',
      'campus_visits', 'call_logs', 'offer_letters', 'waitlist_entries',
      'automation_rule_executions', 'consultant_payouts',
      'whatsapp_campaign_recipients'
    ])
  LOOP
    EXECUTE format(
      'CREATE POLICY "Super admin can delete %I" ON public.%I FOR DELETE TO authenticated USING (public.has_role(auth.uid(), ''super_admin''))',
      tbl, tbl
    );
  END LOOP;
END;
$$;
