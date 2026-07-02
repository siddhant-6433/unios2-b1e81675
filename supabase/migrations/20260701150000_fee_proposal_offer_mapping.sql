-- Fee Proposal -> Offer Letter handoff
-- Approved/current fee proposals can seed approved offer waivers without a
-- second approval cycle, while manual waivers keep the existing approval flow.

ALTER TABLE public.offer_letters
  ADD COLUMN IF NOT EXISTS source_fee_proposal_id uuid REFERENCES public.fee_proposals(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_fee_proposal_child_key text;

ALTER TABLE public.offer_waivers
  ADD COLUMN IF NOT EXISTS source_type text NOT NULL DEFAULT 'manual'
    CHECK (source_type IN ('manual', 'fee_proposal')),
  ADD COLUMN IF NOT EXISTS source_fee_proposal_id uuid REFERENCES public.fee_proposals(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_fee_proposal_child_key text,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_offer_letters_source_fee_proposal
  ON public.offer_letters (source_fee_proposal_id);

CREATE INDEX IF NOT EXISTS idx_offer_waivers_source_fee_proposal
  ON public.offer_waivers (source_fee_proposal_id);

CREATE INDEX IF NOT EXISTS idx_offer_waivers_source_type
  ON public.offer_waivers (source_type);

COMMENT ON COLUMN public.offer_letters.source_fee_proposal_id IS
  'Approved/current fee proposal selected while issuing this offer.';

COMMENT ON COLUMN public.offer_waivers.source_type IS
  'manual for normal offer waiver workflow; fee_proposal for waivers copied from an approved fee proposal.';

COMMENT ON COLUMN public.offer_waivers.metadata IS
  'Source fee-head/category details used for audit and future proposal-to-ledger mapping.';

CREATE OR REPLACE FUNCTION public.handle_offer_waiver_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_role text;
  v_name text;
  v_source_status text;
  v_source_is_current boolean;
  v_source_approved_by uuid;
  v_source_approved_at timestamptz;
  v_source_approved_name text;
BEGIN
  IF v_actor IS NOT NULL THEN
    SELECT role::text INTO v_role
      FROM public.user_roles WHERE user_id = v_actor LIMIT 1;
    SELECT display_name INTO v_name
      FROM public.profiles WHERE user_id = v_actor LIMIT 1;

    NEW.requested_by      := COALESCE(NEW.requested_by, v_actor);
    NEW.requested_by_role := COALESCE(NEW.requested_by_role, v_role);
    NEW.requested_by_name := COALESCE(NEW.requested_by_name, v_name);
  END IF;

  IF NEW.source_type = 'fee_proposal' THEN
    IF NEW.source_fee_proposal_id IS NULL THEN
      RAISE EXCEPTION 'source_fee_proposal_id is required for fee proposal waivers';
    END IF;

    SELECT fp.status, COALESCE(fp.is_current, true), fp.approved_by, fp.approved_at
      INTO v_source_status, v_source_is_current, v_source_approved_by, v_source_approved_at
      FROM public.fee_proposals fp
     WHERE fp.id = NEW.source_fee_proposal_id;

    IF NOT FOUND OR v_source_status <> 'approved' OR v_source_is_current IS NOT TRUE THEN
      RAISE EXCEPTION 'Only approved current fee proposals can seed approved offer waivers';
    END IF;

    IF v_source_approved_by IS NOT NULL THEN
      SELECT display_name INTO v_source_approved_name
        FROM public.profiles WHERE user_id = v_source_approved_by LIMIT 1;
    END IF;

    NEW.status := 'approved';
    NEW.approved_by := COALESCE(NEW.approved_by, v_source_approved_by, v_actor);
    NEW.approved_by_name := COALESCE(NEW.approved_by_name, v_source_approved_name, 'Approved fee proposal');
    NEW.approved_at := COALESCE(NEW.approved_at, v_source_approved_at, now());
  ELSIF v_actor IS NOT NULL THEN
    -- Super admin's own manual waiver is auto-approved. Everyone else's
    -- manual waiver must remain pending even if the client tries to send
    -- status='approved'.
    IF v_role = 'super_admin' AND NEW.status = 'pending' THEN
      NEW.status := 'approved';
      NEW.approved_by := v_actor;
      NEW.approved_by_name := v_name;
      NEW.approved_at := now();
    ELSIF v_role <> 'super_admin' AND NEW.status = 'approved' THEN
      NEW.status := 'pending';
      NEW.approved_by := NULL;
      NEW.approved_by_name := NULL;
      NEW.approved_at := NULL;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
