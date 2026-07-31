-- Merge one duplicate consultant into another: repoint every child row from the
-- "remove" consultant to the "keep" consultant, backfill any fields the keeper is
-- missing, then delete the duplicate. Super-admin only. Idempotent-ish: safe to
-- re-run with a non-existent remove_id (raises), never partially applies (one txn).
CREATE OR REPLACE FUNCTION public.merge_consultants(_keep_id uuid, _remove_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE r public.consultants%ROWTYPE;
BEGIN
  IF NOT public.has_role(auth.uid(), 'super_admin'::app_role) THEN
    RAISE EXCEPTION 'Only super admins can merge consultants';
  END IF;
  IF _keep_id = _remove_id THEN
    RAISE EXCEPTION 'Cannot merge a consultant into itself';
  END IF;
  SELECT * INTO r FROM public.consultants WHERE id = _remove_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Consultant to remove not found'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.consultants WHERE id = _keep_id) THEN
    RAISE EXCEPTION 'Consultant to keep not found';
  END IF;

  -- Collision-prone children first (keeper's existing row wins; drop the dup).
  DELETE FROM public.consultant_commissions lc
   WHERE lc.consultant_id = _remove_id
     AND EXISTS (SELECT 1 FROM public.consultant_commissions k
                  WHERE k.consultant_id = _keep_id AND k.course_id = lc.course_id);
  UPDATE public.consultant_commissions SET consultant_id = _keep_id WHERE consultant_id = _remove_id;

  DELETE FROM public.consultant_fee_management lf
   WHERE lf.consultant_id = _remove_id
     AND EXISTS (SELECT 1 FROM public.consultant_fee_management k
                  WHERE k.consultant_id = _keep_id AND k.course_id = lf.course_id
                    AND k.session_id IS NOT DISTINCT FROM lf.session_id);
  UPDATE public.consultant_fee_management SET consultant_id = _keep_id WHERE consultant_id = _remove_id;

  -- consultant_payouts is UNIQUE(consultant_id, lead_id); a lead has one consultant,
  -- so after the leads repoint below there is no overlap, but guard anyway.
  DELETE FROM public.consultant_payouts lp
   WHERE lp.consultant_id = _remove_id
     AND EXISTS (SELECT 1 FROM public.consultant_payouts k
                  WHERE k.consultant_id = _keep_id AND k.lead_id = lp.lead_id);
  UPDATE public.consultant_payouts SET consultant_id = _keep_id WHERE consultant_id = _remove_id;

  -- Plain repoints (no unique on consultant_id).
  UPDATE public.leads                                 SET consultant_id = _keep_id WHERE consultant_id = _remove_id;
  UPDATE public.commission_edit_requests              SET consultant_id = _keep_id WHERE consultant_id = _remove_id;
  UPDATE public.consultant_voice_messages             SET consultant_id = _keep_id WHERE consultant_id = _remove_id;
  UPDATE public.lead_association_requests             SET consultant_id = _keep_id WHERE consultant_id = _remove_id;
  UPDATE public.consultant_documents                  SET consultant_id = _keep_id WHERE consultant_id = _remove_id;
  UPDATE public.payment_links                         SET consultant_id = _keep_id WHERE consultant_id = _remove_id;
  UPDATE public.student_fee_visibility                SET consultant_id = _keep_id WHERE consultant_id = _remove_id;
  UPDATE public.consultant_credit_notes               SET consultant_id = _keep_id WHERE consultant_id = _remove_id;
  UPDATE public.consultant_fee_collection_remittances SET consultant_id = _keep_id WHERE consultant_id = _remove_id;

  -- Backfill fields the keeper is missing from the duplicate (keeper wins when set).
  -- user_id is captured in r before the delete, so no unique-index clash on update.
  DELETE FROM public.consultants WHERE id = _remove_id;

  UPDATE public.consultants SET
    organization                = COALESCE(organization, r.organization),
    city                        = COALESCE(city, r.city),
    phone                       = COALESCE(phone, r.phone),
    email                       = COALESCE(email, r.email),
    notes                       = COALESCE(notes, r.notes),
    company_name                = COALESCE(company_name, r.company_name),
    company_address             = COALESCE(company_address, r.company_address),
    pan_number                  = COALESCE(pan_number, r.pan_number),
    gst_number                  = COALESCE(gst_number, r.gst_number),
    tan_number                  = COALESCE(tan_number, r.tan_number),
    authorised_signatory_name   = COALESCE(authorised_signatory_name, r.authorised_signatory_name),
    authorised_signatory_contact= COALESCE(authorised_signatory_contact, r.authorised_signatory_contact),
    authorised_signatory_email  = COALESCE(authorised_signatory_email, r.authorised_signatory_email),
    bank_account_name           = COALESCE(bank_account_name, r.bank_account_name),
    bank_account_number         = COALESCE(bank_account_number, r.bank_account_number),
    bank_ifsc                   = COALESCE(bank_ifsc, r.bank_ifsc),
    bank_name                   = COALESCE(bank_name, r.bank_name),
    bank_upi                    = COALESCE(bank_upi, r.bank_upi),
    user_id                     = COALESCE(user_id, r.user_id)
  WHERE id = _keep_id;
END $$;

GRANT EXECUTE ON FUNCTION public.merge_consultants(uuid, uuid) TO authenticated;
