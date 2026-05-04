GRANT SELECT, INSERT, UPDATE, DELETE ON public.lead_payments TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ga_event_log   TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.ga_event_log_id_seq    TO service_role;
