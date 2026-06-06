-- Ensure edge functions using the Supabase service-role client can access the
-- new WhatsApp engine tables through PostgREST. RLS policies alone are not
-- enough without table privileges.

grant select on public.whatsapp_automation_events to authenticated;
grant select, insert, update, delete on public.whatsapp_automation_events to service_role;

grant select on public.course_admission_briefs to authenticated;
grant select, insert, update, delete on public.course_admission_briefs to service_role;

grant select on public.whatsapp_outbound_context to authenticated;
grant select, insert, update, delete on public.whatsapp_outbound_context to service_role;

grant select on public.whatsapp_inbound_events to authenticated;
grant select, insert, update, delete on public.whatsapp_inbound_events to service_role;

grant select on public.whatsapp_channels to authenticated;
grant select, insert, update, delete on public.whatsapp_channels to service_role;
