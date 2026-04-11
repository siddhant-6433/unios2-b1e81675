-- Fix: when super_admin impersonates a consultant, the frontend sets
-- sender_user_id to the consultant's user_id (via AuthContext), but the
-- JWT sent to Supabase is still the super_admin's. So auth.uid() = super_admin
-- and the WITH CHECK (sender_user_id = auth.uid()) fails.
--
-- Allow either the actual user OR admins to insert.

DROP POLICY IF EXISTS "Consultants can insert own voice messages" ON public.consultant_voice_messages;

CREATE POLICY "Consultants and admins can insert voice messages"
  ON public.consultant_voice_messages FOR INSERT TO authenticated
  WITH CHECK (
    sender_user_id = auth.uid()
    OR has_role(auth.uid(), 'super_admin')
    OR has_role(auth.uid(), 'campus_admin')
    OR has_role(auth.uid(), 'admission_head')
  );
