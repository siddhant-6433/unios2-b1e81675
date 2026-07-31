-- academic_partners was created without the standard service_role grants, so
-- edge functions using the service-role client (e.g. generate-apply-link) got
-- permission-denied on reads. .maybeSingle() silently swallows that into
-- partner=null, which flipped isPartnerCaller=false and made on-behalf apply
-- links 403 with "Only academic partners can generate on-behalf application
-- links" — even for legitimately attributed partner leads. Restore the grants
-- service_role should have had. Idempotent (GRANT is a no-op if already held).
GRANT SELECT, INSERT, UPDATE, DELETE ON public.academic_partners TO service_role;
