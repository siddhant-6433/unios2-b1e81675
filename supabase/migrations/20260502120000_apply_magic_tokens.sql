-- Magic login links for the application portal.
-- Counsellors generate a token for a lead → student opens the URL → auto-logged in.
-- Time-based expiry; multiple redemptions allowed within the validity window so
-- a student who closes the tab can come back later. Counsellor can revoke early.

CREATE TABLE IF NOT EXISTS public.apply_magic_tokens (
  token       UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id     UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  phone       TEXT NOT NULL,
  email       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at  TIMESTAMPTZ NOT NULL,
  created_by  UUID REFERENCES public.profiles(id),
  revoked_at  TIMESTAMPTZ,
  last_used_at TIMESTAMPTZ,
  use_count   INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_apply_magic_tokens_lead_id ON public.apply_magic_tokens(lead_id);
CREATE INDEX IF NOT EXISTS idx_apply_magic_tokens_expires_at ON public.apply_magic_tokens(expires_at) WHERE revoked_at IS NULL;

ALTER TABLE public.apply_magic_tokens ENABLE ROW LEVEL SECURITY;

-- Staff (anyone except students/parents) can manage magic tokens for leads.
CREATE POLICY "Staff can manage magic tokens"
  ON public.apply_magic_tokens
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role NOT IN ('student', 'parent')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role NOT IN ('student', 'parent')
    )
  );

COMMENT ON TABLE public.apply_magic_tokens IS
  'One token per generated apply-portal magic link. Time-based expiry, multi-use until expires_at.';
