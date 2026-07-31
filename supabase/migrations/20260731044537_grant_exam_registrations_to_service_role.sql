-- exam_registrations was missing service_role grants, causing edge functions
-- (generate-offer-letter) to get "permission denied" when looking up CAHET/UPDELED
-- registrations via the exam_registrations fallback path.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.exam_registrations TO service_role;
