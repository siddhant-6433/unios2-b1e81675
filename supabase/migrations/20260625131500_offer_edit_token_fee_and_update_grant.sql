-- Offer edit approvals:
-- 1. The UPDATE policy existed, but authenticated users lacked UPDATE table
--    privilege, so super admins saw "permission denied for table
--    offer_letter_edit_requests" when approving/rejecting.
-- 2. Token-fee edit requests must update offer_letters.token_fee_amount, not
--    sit as free text in the request reason.

GRANT UPDATE ON public.offer_letter_edit_requests TO authenticated;

CREATE OR REPLACE FUNCTION public.apply_offer_edit_request()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF OLD.status = NEW.status OR NEW.status <> 'approved' THEN
    RETURN NEW;
  END IF;

  UPDATE public.offer_letters
  SET acceptance_deadline = CASE
        WHEN NEW.proposed_changes ? 'acceptance_deadline'
        THEN (NEW.proposed_changes->>'acceptance_deadline')::date
        ELSE acceptance_deadline
      END,
      token_fee_amount = CASE
        WHEN NEW.proposed_changes ? 'token_fee_amount'
        THEN (NEW.proposed_changes->>'token_fee_amount')::numeric
        ELSE token_fee_amount
      END,
      token_fee_user_edited = CASE
        WHEN NEW.proposed_changes ? 'token_fee_amount'
        THEN true
        ELSE token_fee_user_edited
      END
  WHERE id = NEW.offer_letter_id;

  RETURN NEW;
END;
$$;
