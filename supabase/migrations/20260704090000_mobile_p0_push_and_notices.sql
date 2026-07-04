-- ====================================================================
-- Mobile P0 backend: push device registry, notice read-tracking, and the
-- notifications→push fan-out trigger.
--
-- NOTE: public.notices already exists (institution/course/batch-scoped,
-- audience text 'student'|'guardian'|'both', valid_from/valid_until,
-- complete RLS incl. guardian_links) — the mobile apps adopt that table
-- as-is. This migration only ADDS: push_devices, notice_reads, the
-- notifications type widening + data column, and the push trigger.
--
-- Contract established here: INSERT a row into public.notifications and
-- the user gets an in-app inbox item AND a device push automatically
-- (trigger → pg_net → push-send edge fn → Expo Push API).
--
-- All-new tables with fresh RLS. No existing policy is modified.
-- ====================================================================

-- ────────────────────────────────────────────────────────────────────
-- 1. push_devices — one row per (user, physical device)
-- ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.push_devices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  expo_push_token text NOT NULL UNIQUE,
  platform text NOT NULL CHECK (platform IN ('ios', 'android')),
  app_variant text NOT NULL CHECK (app_variant IN ('staff', 'family')),
  device_name text,
  app_version text,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  disabled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_push_devices_user_active
  ON public.push_devices(user_id) WHERE disabled_at IS NULL;

ALTER TABLE public.push_devices ENABLE ROW LEVEL SECURITY;

-- Own-row CRUD only; the push-send edge fn reads with service role (bypasses RLS).
CREATE POLICY "push_devices_select_own"
  ON public.push_devices FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "push_devices_insert_own"
  ON public.push_devices FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "push_devices_update_own"
  ON public.push_devices FOR UPDATE TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "push_devices_delete_own"
  ON public.push_devices FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

-- ────────────────────────────────────────────────────────────────────
-- 2. notice_reads — unread badges for the EXISTING public.notices
-- ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.notice_reads (
  notice_id uuid NOT NULL REFERENCES public.notices(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  read_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (notice_id, user_id)
);

ALTER TABLE public.notice_reads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "notice_reads_all_own"
  ON public.notice_reads FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- ────────────────────────────────────────────────────────────────────
-- 3. notifications: widen type CHECK + deep-link payload column
--    (constraint swap + additive column — no RLS policy touched)
-- ────────────────────────────────────────────────────────────────────
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS data jsonb;

-- Constraint swap: live production list (30 types) + 8 mobile-era types.
ALTER TABLE public.notifications
  DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE public.notifications
  ADD CONSTRAINT notifications_type_check CHECK (type IN (
    'lead_assigned', 'sla_warning', 'lead_reclaimed',
    'followup_due', 'followup_overdue', 'visit_confirmation_due',
    'visit_followup_due', 'lead_transferred', 'deletion_request',
    'whatsapp_message', 'whatsapp_sla_warning', 'whatsapp_sla_breach',
    'approval_pending', 'approval_decided', 'template_status_update',
    'tat_defaults_report', 'post_visit_nudge', 'score_penalty',
    'lead_bucket_backlog', 'feedback_received', 'campaign_completed',
    'student_service_assigned', 'student_service_unassigned',
    'pgdm_certificate_pending', 'pgdm_certificate_approved',
    'pgdm_diploma_ready', 'general', 'visit_due', 'missed_call',
    'callback_requested',
    -- mobile-era event types
    'notice_published', 'gatepass_update', 'assignment_due',
    'substitution_assigned', 'leave_decision', 'hostel_alert',
    'approval_request', 'payment_receipt'
  ));

-- ────────────────────────────────────────────────────────────────────
-- 4. Fan-out trigger: notifications INSERT → push-send edge fn
--    Exception-guarded: a pg_net hiccup must never roll back the insert.
-- ────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_push_on_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url text;
  v_key text;
BEGIN
  SELECT value INTO v_url FROM public._app_config WHERE key = 'supabase_url';
  SELECT value INTO v_key FROM public._app_config WHERE key = 'service_role_key';
  IF v_url IS NULL OR v_key IS NULL THEN
    RETURN NEW;
  END IF;

  BEGIN
    PERFORM net.http_post(
      url     := v_url || '/functions/v1/push-send',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_key
      ),
      body    := jsonb_build_object(
        'user_ids', jsonb_build_array(NEW.user_id),
        'title', NEW.title,
        'body', COALESCE(NEW.body, ''),
        'data', COALESCE(NEW.data, '{}'::jsonb) || jsonb_build_object(
          'notification_id', NEW.id,
          'type', NEW.type,
          'url', COALESCE(NEW.data->>'url', NEW.link)
        )
      )
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING '[push-on-notification] pg_net call failed: %', SQLERRM;
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_push_on_notification ON public.notifications;
CREATE TRIGGER trg_push_on_notification
  AFTER INSERT ON public.notifications
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_push_on_notification();
