-- The apply_magic_tokens migration enabled RLS but never granted base table
-- access. Service role bypasses RLS but still needs GRANTs at the Postgres
-- layer; without these, both generate-apply-link and redeem-apply-link fail
-- with "permission denied for table apply_magic_tokens".

GRANT SELECT, INSERT, UPDATE, DELETE ON public.apply_magic_tokens TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.apply_magic_tokens TO authenticated;
GRANT SELECT ON public.apply_magic_tokens TO anon;
