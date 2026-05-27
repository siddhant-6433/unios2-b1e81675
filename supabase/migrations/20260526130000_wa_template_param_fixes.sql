-- Fixes for three WhatsApp template failures surfaced by the spam dashboard:
--
-- 1) visit_confirmation (Meta name visit_confirmed) requires a URL-button
--    dynamic suffix (Google Maps CID for the campus). Add a `maps_cid`
--    column on campuses so admins can set it from the Settings panel.
--    whatsapp-send auto-resolves the suffix from the lead's campus_id
--    when callers don't pass button_urls explicitly.
--
-- 2) counsellor_lead_assigned is hitting Meta rate limits (codes 131056 /
--    130429) because every lead assignment fires a WhatsApp ping. Cloud
--    dialer + in-app notifications replace the need for this. Strip the
--    send_whatsapp action from the existing automation rule but keep the
--    create_notification action so counsellors still see the assignment
--    inside the CRM.
--
-- 3) (Handled in whatsapp-send code) course_info_video also requires URL
--    button suffixes; nothing to do here.

ALTER TABLE public.campuses
  ADD COLUMN IF NOT EXISTS maps_cid text;

COMMENT ON COLUMN public.campuses.maps_cid IS
  'Google Maps Place CID used as the dynamic URL-button suffix for visit_confirmation and similar WhatsApp templates. Find it at maps.google.com/?cid=<CID> in the share URL.';

-- Remove the WhatsApp action from the lead-assignment rule. Keep the
-- in-app notification action — counsellors still need that signal.
UPDATE public.automation_rules
SET actions = '[{"type": "create_notification", "notify_counsellor": true, "notification_type": "lead_assigned", "title": "New lead assigned: {{name}}", "body": "Make first contact within the SLA window."}]'::jsonb,
    updated_at = now()
WHERE name = 'Lead Assigned → WhatsApp to Counsellor';
