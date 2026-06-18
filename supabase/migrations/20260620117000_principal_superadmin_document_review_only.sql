-- Counsellors can upload/re-upload documents for applicants, but document
-- verification is an approval action. Keep staff visibility broad, and narrow
-- application_doc_reviews writes to principal + super_admin only.
DROP POLICY IF EXISTS "approvers can insert app doc reviews" ON public.application_doc_reviews;
DROP POLICY IF EXISTS "approvers can update app doc reviews" ON public.application_doc_reviews;
DROP POLICY IF EXISTS "approvers can delete app doc reviews" ON public.application_doc_reviews;

CREATE POLICY "approvers can insert app doc reviews"
  ON public.application_doc_reviews
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'super_admin')
    OR public.has_role(auth.uid(), 'principal')
  );

CREATE POLICY "approvers can update app doc reviews"
  ON public.application_doc_reviews
  FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin')
    OR public.has_role(auth.uid(), 'principal')
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'super_admin')
    OR public.has_role(auth.uid(), 'principal')
  );

CREATE POLICY "approvers can delete app doc reviews"
  ON public.application_doc_reviews
  FOR DELETE TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin')
    OR public.has_role(auth.uid(), 'principal')
  );
