-- Kill switch A — disable the AI-call → lead_welcome WhatsApp automation.
--
-- Background: Meta has flagged the default phone number after a wave of spam
-- markings. The single highest-volume marketing-flavoured send is
-- lead_welcome, fired by the automation rule "AI Call → WhatsApp Course Info"
-- (added by 20260514100000_activate_core_automations.sql) on every stage
-- change to counsellor_call. Recipients are often third-party ad/JustDial
-- leads who never asked NIMT to message them, which yields high block and
-- report rates.
--
-- This migration deactivates the rule. The new course_info_v1 template (sent
-- by the voice agent after AI call completion via fn_resolve_course_info_params)
-- replaces it with course-specific, data-driven copy on the call route's
-- dedicated Meta number, isolating quality damage from this path.
--
-- To re-enable: toggle the rule from Settings → Automation Rules in the app,
-- or run UPDATE public.automation_rules SET is_active = true WHERE
-- name = 'AI Call → WhatsApp Course Info'.

UPDATE public.automation_rules
   SET is_active = false,
       updated_at = now()
 WHERE name = 'AI Call → WhatsApp Course Info'
   AND is_active = true;
