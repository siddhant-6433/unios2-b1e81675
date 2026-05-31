-- Flip the new-lead auto-send from the legacy course_info_video to v2.
--
-- ⚠️ APPLY ONLY AFTER course_info_video_v2 is APPROVED in Meta Business Manager.
-- Before approval, sends on this template fail with an unknown-template error.
--
-- Dropping params_template makes whatsapp-send run fn_resolve_course_info_video_params,
-- which fills the course / campus / apply links (with /courses & /contact
-- fallbacks) per-lead.
UPDATE public.automation_rules
SET actions = '[{"type": "send_whatsapp", "template_key": "course_info_video_v2"}]'::jsonb,
    updated_at = now()
WHERE name = 'Send Course Info Video to New Leads';
