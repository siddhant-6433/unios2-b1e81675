-- Academic partner "submit on behalf" flow.
-- Partner access is represented by scoped apply magic tokens and every
-- privileged action is written to an internal audit table.

ALTER TABLE public.apply_magic_tokens
  ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'student',
  ADD COLUMN IF NOT EXISTS actor_user_id UUID REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS actor_role public.app_role,
  ADD COLUMN IF NOT EXISTS academic_partner_id UUID REFERENCES public.academic_partners(id);

CREATE INDEX IF NOT EXISTS idx_apply_magic_tokens_on_behalf
  ON public.apply_magic_tokens(mode, academic_partner_id, lead_id)
  WHERE mode = 'academic_partner_on_behalf' AND revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS public.application_on_behalf_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action TEXT NOT NULL,
  lead_id UUID REFERENCES public.leads(id) ON DELETE SET NULL,
  application_uuid UUID REFERENCES public.applications(id) ON DELETE SET NULL,
  application_id TEXT,
  offer_letter_id UUID REFERENCES public.offer_letters(id) ON DELETE SET NULL,
  lead_payment_id UUID REFERENCES public.lead_payments(id) ON DELETE SET NULL,
  payment_ref TEXT,
  actor_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  academic_partner_id UUID REFERENCES public.academic_partners(id) ON DELETE SET NULL,
  candidate_phone TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_on_behalf_audit_lead
  ON public.application_on_behalf_audit(lead_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_on_behalf_audit_partner
  ON public.application_on_behalf_audit(academic_partner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_on_behalf_audit_action
  ON public.application_on_behalf_audit(action, created_at DESC);

ALTER TABLE public.application_on_behalf_audit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Staff can view on behalf audit" ON public.application_on_behalf_audit;
CREATE POLICY "Staff can view on behalf audit"
  ON public.application_on_behalf_audit
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.role IN ('super_admin', 'campus_admin', 'admission_head', 'principal', 'data_entry')
    )
    OR (
      actor_user_id = auth.uid()
      AND EXISTS (
        SELECT 1 FROM public.user_roles ur
        WHERE ur.user_id = auth.uid()
          AND ur.role = 'academic_partner'
      )
    )
  );

CREATE TABLE IF NOT EXISTS public.academic_partner_offer_otps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token UUID NOT NULL REFERENCES public.apply_magic_tokens(token) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  application_uuid UUID REFERENCES public.applications(id) ON DELETE CASCADE,
  application_id TEXT NOT NULL,
  offer_letter_id UUID NOT NULL REFERENCES public.offer_letters(id) ON DELETE CASCADE,
  actor_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  academic_partner_id UUID NOT NULL REFERENCES public.academic_partners(id) ON DELETE CASCADE,
  candidate_phone TEXT NOT NULL,
  otp_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  verified_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_academic_partner_offer_otps_active
  ON public.academic_partner_offer_otps(token, offer_letter_id, expires_at DESC)
  WHERE verified_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_academic_partner_offer_otps_verified
  ON public.academic_partner_offer_otps(token, offer_letter_id, verified_at DESC)
  WHERE verified_at IS NOT NULL;

ALTER TABLE public.academic_partner_offer_otps ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.application_on_behalf_audit IS
  'Internal audit trail for actions academic partners perform for assigned candidates.';

COMMENT ON TABLE public.academic_partner_offer_otps IS
  'Short-lived student WhatsApp OTP consent for academic-partner offer acceptance/token fee actions.';
