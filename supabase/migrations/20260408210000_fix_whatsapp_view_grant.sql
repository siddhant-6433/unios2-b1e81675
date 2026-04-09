-- Grant SELECT on underlying tables to authenticated role so the view works
GRANT SELECT ON public.whatsapp_messages TO anon;
GRANT SELECT ON public.whatsapp_messages TO authenticated;
GRANT SELECT ON public.whatsapp_conversations TO anon;
GRANT SELECT ON public.whatsapp_conversations TO authenticated;
