-- Allow consultants to insert leads (linked to themselves)
CREATE POLICY "Consultants can insert leads"
  ON public.leads FOR INSERT TO authenticated
  WITH CHECK (
    has_role(auth.uid(), 'consultant'::app_role)
    AND consultant_id IN (SELECT id FROM public.consultants WHERE user_id = auth.uid())
  );

-- Allow consultants to view their own leads
CREATE POLICY "Consultants can view own leads"
  ON public.leads FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'consultant'::app_role)
    AND consultant_id IN (SELECT id FROM public.consultants WHERE user_id = auth.uid())
  );

-- Allow consultants to insert lead_activities for their leads
CREATE POLICY "Consultants can insert lead_activities"
  ON public.lead_activities FOR INSERT TO authenticated
  WITH CHECK (
    has_role(auth.uid(), 'consultant'::app_role)
    AND lead_id IN (
      SELECT l.id FROM public.leads l
      JOIN public.consultants c ON c.id = l.consultant_id
      WHERE c.user_id = auth.uid()
    )
  );
