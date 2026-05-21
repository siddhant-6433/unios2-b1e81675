-- RPC: transfer all data from one counsellor/staff profile to another
-- Transfers: leads.counsellor_id, whatsapp_messages.assigned_to
-- Optionally disables source account login after transfer
-- Only super_admin may call this.

CREATE OR REPLACE FUNCTION public.transfer_counsellor_account(
  source_profile_id uuid,
  target_profile_id uuid,
  disable_source boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_leads      integer;
  v_wa_msgs    integer;
BEGIN
  IF NOT public.has_role(auth.uid(), 'super_admin') THEN
    RAISE EXCEPTION 'Only super admins can transfer accounts';
  END IF;

  IF source_profile_id = target_profile_id THEN
    RAISE EXCEPTION 'Source and target must be different';
  END IF;

  -- Transfer lead assignments
  UPDATE public.leads
  SET counsellor_id = target_profile_id
  WHERE counsellor_id = source_profile_id;
  GET DIAGNOSTICS v_leads = ROW_COUNT;

  -- Transfer WhatsApp inbox assignments
  UPDATE public.whatsapp_messages
  SET assigned_to = target_profile_id
  WHERE assigned_to = source_profile_id;
  GET DIAGNOSTICS v_wa_msgs = ROW_COUNT;

  IF disable_source THEN
    UPDATE public.profiles SET login_disabled = true WHERE id = source_profile_id;
  END IF;

  RETURN jsonb_build_object(
    'leads_transferred', v_leads,
    'whatsapp_messages_transferred', v_wa_msgs
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.transfer_counsellor_account(uuid, uuid, boolean) TO authenticated;
