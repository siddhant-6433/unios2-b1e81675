-- Consultants must never be able to record payments. The consultant portal
-- had a bespoke client-side insert into lead_payments backed by this RLS
-- policy, bypassing the finance permission matrix (consultants have no
-- finance:create). Recording payments is staff-only (see
-- "Staff can insert lead_payments"). Drop the consultant insert path; their
-- SELECT policy ("Consultants can view payments for own leads") stays so the
-- portal can still display/receipt payments recorded by staff.
DROP POLICY IF EXISTS "Consultants can record payments for own leads" ON public.lead_payments;
