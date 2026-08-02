-- ====================================================================
-- Accountants can view leads.
--
-- The cashier/accountant desk works search-first across students AND
-- pre-admission leads/applicants: collect a token fee, issue a receipt,
-- send a payment link. None of that was reachable, because can_view_lead()
-- listed super_admin / campus_admin / admission_head / principal /
-- data_entry but NOT accountant.
--
-- The knock-on effect was worse than a blocked page: v_all_payments is a
-- security_invoker view, so for an accountant the LEFT JOIN on leads
-- yielded NULL and every lead-sourced payment came back with
-- campus_id = NULL. FeeCollections then dropped those rows in its
-- client-side campus filter, and the whole Collections page rendered
-- empty for the one role that lives in it.
--
-- This is a WIDENING for a single global finance role, added inside the
-- existing first EXISTS so it short-circuits with the other global roles
-- and adds no per-row cost to this RLS hotspot.
--
-- Body copied verbatim from 20260624100600_manual_external_owner_assignment.sql
-- with one line added.
-- ====================================================================

CREATE OR REPLACE FUNCTION public.can_view_lead(_user_id uuid, _lead_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 WHERE has_role(_user_id, 'super_admin')
      OR has_role(_user_id, 'campus_admin')
      OR has_role(_user_id, 'admission_head')
      OR has_role(_user_id, 'principal')
      OR has_role(_user_id, 'data_entry')
      OR has_role(_user_id, 'accountant')
  )
  OR EXISTS (
    SELECT 1 FROM public.leads l
    JOIN public.profiles p ON p.id = l.counsellor_id
    WHERE l.id = _lead_id AND p.user_id = _user_id
  )
  OR EXISTS (
    SELECT 1 FROM public.lead_counsellors lc
    JOIN public.profiles p ON p.id = lc.counsellor_id
    WHERE lc.lead_id = _lead_id AND p.user_id = _user_id
  )
  OR EXISTS (
    SELECT 1 FROM public.teams t
    JOIN public.profiles leader_p ON leader_p.id = t.leader_id AND leader_p.user_id = _user_id
    JOIN public.team_members tm ON tm.team_id = t.id
    WHERE EXISTS (
      SELECT 1 FROM public.leads l
      JOIN public.profiles mp ON mp.user_id = tm.user_id AND mp.id = l.counsellor_id
      WHERE l.id = _lead_id
    )
    OR EXISTS (
      SELECT 1 FROM public.lead_counsellors lc
      JOIN public.profiles mp ON mp.user_id = tm.user_id AND mp.id = lc.counsellor_id
      WHERE lc.lead_id = _lead_id
    )
  )
  OR EXISTS (
    SELECT 1 FROM public.publishers pb
    JOIN public.leads l ON l.source::text = pb.source
    WHERE pb.user_id = _user_id AND pb.is_active = true AND l.id = _lead_id
  )
  OR public.can_academic_partner_view_mapped_lead(_user_id, _lead_id)
$$;

NOTIFY pgrst, 'reload schema';
