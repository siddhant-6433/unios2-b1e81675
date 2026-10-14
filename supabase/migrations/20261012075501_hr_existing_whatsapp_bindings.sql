-- keep-migration-version: restored production migration 20261012075501; preserve its applied version.
-- Bind HR stages to Uni's existing synced, approved templates; no new Meta templates.
CREATE TABLE IF NOT EXISTS public.hr_whatsapp_bindings (
 stage text PRIMARY KEY CHECK(stage IN ('offer','onboarding')),
 template_name text, language text NOT NULL DEFAULT 'en',
 body_fields text[] NOT NULL DEFAULT '{}', button_fields jsonb NOT NULL DEFAULT '{}'
);
INSERT INTO hr_whatsapp_bindings(stage,template_name,body_fields) VALUES
 ('offer','hiring_offer_extended',ARRAY['candidate_name','role','joining_date']),
 ('onboarding',NULL,ARRAY[]::text[]) ON CONFLICT DO NOTHING;
ALTER TABLE hr_whatsapp_bindings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS hr_whatsapp_read ON hr_whatsapp_bindings;
CREATE POLICY hr_whatsapp_read ON hr_whatsapp_bindings FOR SELECT TO authenticated
 USING(is_account_active(auth.uid()) AND has_permission(auth.uid(),'hr:view'));
DROP POLICY IF EXISTS hr_whatsapp_edit ON hr_whatsapp_bindings;
CREATE POLICY hr_whatsapp_edit ON hr_whatsapp_bindings FOR UPDATE TO authenticated
 USING(is_account_active(auth.uid()) AND has_permission(auth.uid(),'hr:employees_edit'))
 WITH CHECK(is_account_active(auth.uid()) AND has_permission(auth.uid(),'hr:employees_edit'));
GRANT SELECT,UPDATE ON hr_whatsapp_bindings TO authenticated;
GRANT ALL ON hr_whatsapp_bindings TO service_role;

-- HR executives need the existing catalogue to select approved templates.
DROP POLICY IF EXISTS hr_approved_whatsapp_catalogue ON public.whatsapp_templates;
CREATE POLICY hr_approved_whatsapp_catalogue ON public.whatsapp_templates FOR SELECT TO authenticated
 USING(status='APPROVED' AND is_account_active(auth.uid()) AND has_permission(auth.uid(),'hr:employees_edit'));
