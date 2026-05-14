-- Tighten email_messages RLS.
--
-- Prior state: "Anyone can manage email_messages" with USING(true) WITH CHECK(true)
-- on ALL commands. Every authenticated user could read every email logged
-- through the send-email edge function.
--
-- No frontend code reads email_messages today (only supabase/functions/
-- send-email/index.ts INSERTs via service_role). Mirror the whatsapp_messages
-- policy: staff SELECT, no authenticated INSERT (service_role handles it),
-- DELETE for super_admin only.

DROP POLICY IF EXISTS "Anyone can manage email_messages" ON public.email_messages;

CREATE POLICY "Staff can read email_messages"
  ON public.email_messages
  FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'super_admin'::app_role)
    OR has_role(auth.uid(), 'campus_admin'::app_role)
    OR has_role(auth.uid(), 'principal'::app_role)
    OR has_role(auth.uid(), 'admission_head'::app_role)
    OR has_role(auth.uid(), 'counsellor'::app_role)
    OR has_role(auth.uid(), 'office_admin'::app_role)
  );

CREATE POLICY "Super admin can delete email_messages"
  ON public.email_messages
  FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'super_admin'::app_role));
