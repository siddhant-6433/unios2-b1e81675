-- Principals (and anyone else allowed to assign a lead's external owner) could
-- open the "Assign external owner" dialog but got an empty Academic Partner
-- picklist: academic_partners had no SELECT policy covering principal, so the
-- dialog's direct table query returned nothing. can_assign_lead_external_owner
-- already gates the write RPC (super_admin, principal, leads:assign_external_owner
-- holders, counsellor+consultants:view); mirror it on the picklist reads so the
-- dropdowns populate for exactly the roles allowed to assign.
CREATE POLICY "Owner-assigners can view academic partners"
  ON public.academic_partners FOR SELECT TO authenticated
  USING (public.can_assign_lead_external_owner(auth.uid()));

CREATE POLICY "Owner-assigners can view consultants"
  ON public.consultants FOR SELECT TO authenticated
  USING (public.can_assign_lead_external_owner(auth.uid()));
