-- Make the real Meta template list visible to the people who send templates.
--
-- Context: whatsapp_templates mirrors 101 approved Meta templates, but its
-- SELECT policy allowed only super_admin and admission_head. Every template
-- picker (lead detail, cloud dialer, WhatsApp inbox) reads that table as the
-- logged-in counsellor, so the query returned an empty array with no error and
-- the picker silently fell back to hardcoded arrays with hand-written preview
-- text. That is the "templates look fake or hallucinated" report.
--
-- Reading approved template metadata is not sensitive — it is the same text we
-- send to students. Writes stay service-role only (no INSERT/UPDATE/DELETE
-- policy exists), so this widens read access and nothing else.

DROP POLICY IF EXISTS "Admins can read whatsapp_templates" ON public.whatsapp_templates;
DROP POLICY IF EXISTS "Staff can read whatsapp_templates" ON public.whatsapp_templates;

-- Exactly the role set that can already read whatsapp_messages
-- (20260513160812_tighten_whatsapp_messages_rls.sql). Anyone who can read the
-- conversation can already see the sent template text, so this grants no new
-- visibility — it just stops the picker from silently getting an empty list.
CREATE POLICY "Staff can read whatsapp_templates"
  ON public.whatsapp_templates
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin'::public.app_role) OR
    public.has_role(auth.uid(), 'campus_admin'::public.app_role) OR
    public.has_role(auth.uid(), 'principal'::public.app_role) OR
    public.has_role(auth.uid(), 'admission_head'::public.app_role) OR
    public.has_role(auth.uid(), 'counsellor'::public.app_role) OR
    public.has_role(auth.uid(), 'office_admin'::public.app_role)
  );

COMMENT ON POLICY "Staff can read whatsapp_templates" ON public.whatsapp_templates IS
  'Any staff role that can send WhatsApp needs the approved template list, its body text and its placeholder count. Writes remain service-role only.';

-- ── Keep the mirror fresh ───────────────────────────────────────────────────
-- The Graph sync only ever ran when an admin clicked "Sync" in the Template
-- Manager, so status, components and placeholder_count drifted from Meta. The
-- send-time parameter guard now trusts placeholder_count, which makes staleness
-- a correctness problem rather than a cosmetic one.

SELECT cron.unschedule('whatsapp-templates-sync')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'whatsapp-templates-sync');

SELECT cron.schedule(
  'whatsapp-templates-sync',
  '30 1 * * *',
  $$
  SELECT
    net.http_post(
      url     := 'https://deylhigsisuexszsmypq.supabase.co/functions/v1/whatsapp-templates',
      headers := jsonb_build_object(
        'Content-Type',  'application/json',
        'x-cron-secret', '825230a9abd38418482572ca5ec24dbd06221ffa'
      ),
      body    := '{"action": "sync"}'::jsonb
    )
  $$
);

-- Pickers filter on status and join settings by name on every load.
CREATE INDEX IF NOT EXISTS idx_wa_templates_status_name
  ON public.whatsapp_templates (status, name);
