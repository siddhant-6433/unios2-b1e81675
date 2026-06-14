-- Counsellors may view application documents, but document approval/rejection
-- is an approver action. Keep SELECT broad for staff visibility and restrict
-- INSERT/UPDATE/DELETE on application_doc_reviews to team leaders, principals,
-- and super admins.

DROP POLICY IF EXISTS "staff manage app doc reviews" ON public.application_doc_reviews;
DROP POLICY IF EXISTS "staff can view app doc reviews" ON public.application_doc_reviews;
DROP POLICY IF EXISTS "approvers can insert app doc reviews" ON public.application_doc_reviews;
DROP POLICY IF EXISTS "approvers can update app doc reviews" ON public.application_doc_reviews;
DROP POLICY IF EXISTS "approvers can delete app doc reviews" ON public.application_doc_reviews;

CREATE POLICY "staff can view app doc reviews"
  ON public.application_doc_reviews
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN (
          'super_admin', 'campus_admin', 'principal', 'admission_head',
          'counsellor', 'office_admin', 'office_assistant'
        )
    )
  );

CREATE POLICY "approvers can insert app doc reviews"
  ON public.application_doc_reviews
  FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'super_admin')
    OR public.has_role(auth.uid(), 'principal')
    OR EXISTS (
      SELECT 1
      FROM public.profiles p
      JOIN public.teams t ON t.leader_id = p.id
      WHERE p.user_id = auth.uid()
    )
  );

CREATE POLICY "approvers can update app doc reviews"
  ON public.application_doc_reviews
  FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin')
    OR public.has_role(auth.uid(), 'principal')
    OR EXISTS (
      SELECT 1
      FROM public.profiles p
      JOIN public.teams t ON t.leader_id = p.id
      WHERE p.user_id = auth.uid()
    )
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'super_admin')
    OR public.has_role(auth.uid(), 'principal')
    OR EXISTS (
      SELECT 1
      FROM public.profiles p
      JOIN public.teams t ON t.leader_id = p.id
      WHERE p.user_id = auth.uid()
    )
  );

CREATE POLICY "approvers can delete app doc reviews"
  ON public.application_doc_reviews
  FOR DELETE TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin')
    OR public.has_role(auth.uid(), 'principal')
    OR EXISTS (
      SELECT 1
      FROM public.profiles p
      JOIN public.teams t ON t.leader_id = p.id
      WHERE p.user_id = auth.uid()
    )
  );
