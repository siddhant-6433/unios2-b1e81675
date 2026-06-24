-- WhatsApp Template Submission & Approval System
-- ───────────────────────────────────────────────────────────────────────────
-- Local mirror of WhatsApp message templates submitted to Meta. Rows are
-- written by the `whatsapp-templates` edge function on create/sync and updated
-- by the `whatsapp-webhook` edge function when Meta sends
-- `message_template_status_update` events. The dashboard reads this table
-- (with realtime) instead of polling the Graph API on every view.

CREATE TABLE IF NOT EXISTS public.whatsapp_templates (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  meta_template_id   text,                              -- Meta's template id (known after create)
  name               text NOT NULL,
  language           text NOT NULL DEFAULT 'en',
  category           text,                              -- UTILITY / MARKETING / AUTHENTICATION
  status             text NOT NULL DEFAULT 'PENDING'    -- PENDING/APPROVED/REJECTED/PAUSED/DISABLED/IN_APPEAL
    CHECK (status IN ('PENDING','APPROVED','REJECTED','PAUSED','DISABLED','IN_APPEAL','FLAGGED')),
  header_format      text DEFAULT 'NONE'                -- NONE/TEXT/IMAGE/VIDEO/DOCUMENT
    CHECK (header_format IN ('NONE','TEXT','IMAGE','VIDEO','DOCUMENT')),
  has_media          boolean NOT NULL DEFAULT false,
  placeholder_count  int NOT NULL DEFAULT 0,
  components         jsonb,                             -- full submitted component array
  reject_reason      text,
  quality_score      text,                              -- GREEN / YELLOW / RED (when known)
  created_by         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  submitted_at       timestamptz NOT NULL DEFAULT now(),
  status_updated_at  timestamptz,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (name, language)
);

CREATE INDEX IF NOT EXISTS idx_wa_templates_status ON public.whatsapp_templates(status);
CREATE INDEX IF NOT EXISTS idx_wa_templates_meta_id ON public.whatsapp_templates(meta_template_id);

ALTER TABLE public.whatsapp_templates ENABLE ROW LEVEL SECURITY;

-- Read: admins only (the Template Manager page is already permission-gated).
DROP POLICY IF EXISTS "Admins can read whatsapp_templates" ON public.whatsapp_templates;
CREATE POLICY "Admins can read whatsapp_templates"
  ON public.whatsapp_templates
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin'::public.app_role) OR
    public.has_role(auth.uid(), 'admission_head'::public.app_role)
  );

-- Writes happen exclusively through edge functions using the service role,
-- which bypasses RLS. No authenticated INSERT/UPDATE/DELETE policy is granted.

CREATE TRIGGER trg_whatsapp_templates_updated_at
  BEFORE UPDATE ON public.whatsapp_templates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

GRANT SELECT ON public.whatsapp_templates TO authenticated;

-- Live status updates in the dashboard list.
ALTER PUBLICATION supabase_realtime ADD TABLE public.whatsapp_templates;

COMMENT ON TABLE public.whatsapp_templates IS
  'Local mirror of Meta WhatsApp message templates: submission record + approval status, updated via Graph API create/sync and message_template_status_update webhooks.';

-- ───────────────────────────────────────────────────────────────────────────
-- Allow the new notification type fired on template status changes.
-- Re-create the constraint with the full existing list + the new value.
ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN (
    'lead_assigned', 'sla_warning', 'lead_reclaimed',
    'followup_due', 'followup_overdue', 'visit_confirmation_due',
    'visit_followup_due', 'lead_transferred', 'deletion_request', 'general',
    'whatsapp_message', 'approval_pending', 'approval_decided',
    'tat_defaults_report', 'post_visit_nudge', 'score_penalty',
    'lead_bucket_backlog',
    'template_status_update',
    -- Legacy types found in production data when the constraint was first
    -- (re)applied — preserved so the CHECK doesn't reject existing rows.
    'visit_due', 'missed_call', 'callback_requested'
  ));
