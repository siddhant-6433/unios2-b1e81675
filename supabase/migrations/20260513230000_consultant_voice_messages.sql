-- Voice messages from consultants → NIMT admission team
-- Stored as audio files in storage; metadata in this table

CREATE TABLE IF NOT EXISTS public.consultant_voice_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consultant_id uuid REFERENCES public.consultants(id) ON DELETE SET NULL,
  sender_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  audio_url text NOT NULL,
  audio_path text NOT NULL,         -- storage path for delete cleanup
  duration_seconds int,
  subject text,                      -- short label / topic
  status text NOT NULL DEFAULT 'unread' CHECK (status IN ('unread', 'read', 'resolved')),
  read_by uuid REFERENCES auth.users(id),
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cvm_status ON public.consultant_voice_messages(status);
CREATE INDEX IF NOT EXISTS idx_cvm_consultant ON public.consultant_voice_messages(consultant_id);
CREATE INDEX IF NOT EXISTS idx_cvm_created ON public.consultant_voice_messages(created_at DESC);

ALTER TABLE public.consultant_voice_messages ENABLE ROW LEVEL SECURITY;

-- Consultants can insert their own voice messages
CREATE POLICY "Consultants can insert own voice messages"
  ON public.consultant_voice_messages FOR INSERT TO authenticated
  WITH CHECK (sender_user_id = auth.uid());

-- Consultants can view their own messages; admin team sees all
CREATE POLICY "Consultants and admins can view voice messages"
  ON public.consultant_voice_messages FOR SELECT TO authenticated
  USING (
    sender_user_id = auth.uid()
    OR has_role(auth.uid(), 'super_admin')
    OR has_role(auth.uid(), 'principal')
    OR has_role(auth.uid(), 'admission_head')
    OR has_role(auth.uid(), 'campus_admin')
  );

-- Admin team can mark as read/resolved
CREATE POLICY "Admins can update voice messages"
  ON public.consultant_voice_messages FOR UPDATE TO authenticated
  USING (
    has_role(auth.uid(), 'super_admin')
    OR has_role(auth.uid(), 'principal')
    OR has_role(auth.uid(), 'admission_head')
    OR has_role(auth.uid(), 'campus_admin')
  );

GRANT SELECT, INSERT, UPDATE ON public.consultant_voice_messages TO authenticated;
GRANT ALL ON public.consultant_voice_messages TO service_role;

-- =====================================================
-- Storage bucket for voice messages
-- =====================================================
INSERT INTO storage.buckets (id, name, public)
VALUES ('consultant-voice', 'consultant-voice', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "Authenticated can upload to consultant-voice"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'consultant-voice');

CREATE POLICY "Anyone can read consultant-voice"
  ON storage.objects FOR SELECT
  TO anon, authenticated
  USING (bucket_id = 'consultant-voice');

-- =====================================================
-- Trigger: notify super_admin/principal/admission_head on new voice message
-- =====================================================
CREATE OR REPLACE FUNCTION public.fn_notify_voice_message()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_consultant_name text;
BEGIN
  SELECT name INTO v_consultant_name FROM consultants WHERE id = NEW.consultant_id;

  FOR v_user_id IN
    SELECT user_id FROM user_roles
    WHERE role IN ('super_admin'::app_role, 'principal'::app_role, 'admission_head'::app_role)
  LOOP
    INSERT INTO notifications (user_id, type, title, body, link)
    VALUES (
      v_user_id,
      'general',
      'New voice message from consultant',
      format('%s sent a voice message%s',
             COALESCE(v_consultant_name, 'A consultant'),
             CASE WHEN NEW.subject IS NOT NULL THEN ': ' || NEW.subject ELSE '' END),
      '/?voice_messages=1'
    );
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_voice_message ON public.consultant_voice_messages;
CREATE TRIGGER trg_notify_voice_message
  AFTER INSERT ON public.consultant_voice_messages
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_notify_voice_message();

-- =====================================================
-- Track consultant onboarding tour state
-- =====================================================
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS consultant_tour_completed boolean DEFAULT false;
