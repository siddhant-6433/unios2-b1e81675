-- Let the accountant read offer waivers (view only).
--
-- Finance → Approvals renders an Offer Waivers panel whose own banner says
-- "Only super admins can approve or reject waivers. You can view all requests
-- here." For an accountant that second sentence was false: the offer_waivers
-- SELECT policy listed super_admin, principal, admission_head, counsellor and
-- campus_admin — every staff role except the one whose tab this is.
--
-- The panel therefore rendered "No pending waiver requests" while 49 sat
-- pending. The tab badge said 45 anyway, because that count is fetched with
-- PostgREST's count:"planned" — a query-planner row estimate that never sees
-- RLS. So the accountant was told 45 approvals were waiting and shown none,
-- with no error to explain the gap.
--
-- offer_letters — the parent record, carrying the fee and scholarship amounts —
-- already grants accountant SELECT, so this is not new information, just the
-- waiver rows that hang off it.
--
-- View only. Approve/reject stays super_admin: no INSERT/UPDATE/DELETE policy
-- is added here, and the panel's own gate is unchanged.

DROP POLICY IF EXISTS "Staff can view offer waivers" ON public.offer_waivers;
CREATE POLICY "Staff can view offer waivers"
  ON public.offer_waivers
  FOR SELECT
  USING (
    has_role(auth.uid(), 'super_admin'::app_role)
    OR has_role(auth.uid(), 'principal'::app_role)
    OR has_role(auth.uid(), 'admission_head'::app_role)
    OR has_role(auth.uid(), 'counsellor'::app_role)
    OR has_role(auth.uid(), 'campus_admin'::app_role)
    OR has_role(auth.uid(), 'accountant'::app_role)
  );
