-- Tighten whatsapp_messages RLS.
--
-- Prior state: a single "Anyone can manage whatsapp_messages" policy with
-- USING(true) and WITH CHECK(true) on ALL commands. Any authenticated user
-- (student, parent, applicant, consultant) could read or delete every WhatsApp
-- message in the system — entire lead conversation archive exposed.
--
-- Frontend consumers: WhatsAppInbox.tsx, WhatsAppPanel.tsx, AppSidebar.tsx,
-- Inbox.tsx — all already role-gated in UI (ALLOWED_ROLES = super_admin,
-- campus_admin, principal, admission_head, counsellor + hr_manager). Backend
-- ingest (whatsapp-webhook, whatsapp-send, whatsapp-ai-reply, whatsapp-reply,
-- dnc-scan) all use the service_role admin client, which bypasses RLS — so
-- new policies can safely exclude INSERT for end-users.

DROP POLICY IF EXISTS "Anyone can manage whatsapp_messages" ON public.whatsapp_messages;

-- Staff read: matches ALLOWED_ROLES in src/pages/WhatsAppInbox.tsx.
-- hr_manager isn't a real app_role today; if it ever ships, add it here.
CREATE POLICY "Staff can read whatsapp_messages"
  ON public.whatsapp_messages
  FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'super_admin'::app_role)
    OR has_role(auth.uid(), 'campus_admin'::app_role)
    OR has_role(auth.uid(), 'principal'::app_role)
    OR has_role(auth.uid(), 'admission_head'::app_role)
    OR has_role(auth.uid(), 'counsellor'::app_role)
    OR has_role(auth.uid(), 'office_admin'::app_role)
  );

-- Staff update: mark read / link to lead (see WhatsAppInbox.tsx lines 485, 1220).
CREATE POLICY "Staff can update whatsapp_messages"
  ON public.whatsapp_messages
  FOR UPDATE TO authenticated
  USING (
    has_role(auth.uid(), 'super_admin'::app_role)
    OR has_role(auth.uid(), 'campus_admin'::app_role)
    OR has_role(auth.uid(), 'principal'::app_role)
    OR has_role(auth.uid(), 'admission_head'::app_role)
    OR has_role(auth.uid(), 'counsellor'::app_role)
    OR has_role(auth.uid(), 'office_admin'::app_role)
  )
  WITH CHECK (
    has_role(auth.uid(), 'super_admin'::app_role)
    OR has_role(auth.uid(), 'campus_admin'::app_role)
    OR has_role(auth.uid(), 'principal'::app_role)
    OR has_role(auth.uid(), 'admission_head'::app_role)
    OR has_role(auth.uid(), 'counsellor'::app_role)
    OR has_role(auth.uid(), 'office_admin'::app_role)
  );

-- INSERT path is exclusively through edge functions running with service_role.
-- No authenticated INSERT policy is created intentionally.

-- DELETE: super_admin only (defensive; nothing in the app actually deletes
-- messages, but the prior policy permitted any auth user to delete).
CREATE POLICY "Super admin can delete whatsapp_messages"
  ON public.whatsapp_messages
  FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'super_admin'::app_role));
