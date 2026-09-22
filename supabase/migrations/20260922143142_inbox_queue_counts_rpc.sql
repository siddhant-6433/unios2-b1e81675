-- inbox queue counts rpc

-- The Inbox computed each of its ~14 queue badge counts by fetching the
-- matching rows and taking .length on the client, then excluded hidden
-- students with two further lookups. That kept the page waiting 5-10s on the
-- slowest RLS-scoped scan before it could render anything.
--
-- This returns one exact count per queue in a single round trip. Kept
-- SECURITY INVOKER so RLS still scopes every count to the caller; no RLS
-- policies or table grants are changed. The hidden lead/student exclusion the
-- client did in fetchHiddenLeadIds/fetchHiddenStudentIds is folded into each
-- subquery: a student row is hidden when login_disabled, archived_at, or
-- deleted_at is set.
CREATE OR REPLACE FUNCTION public.get_inbox_counts()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    -- Offer waivers awaiting a decision (lead-backed; hidden leads excluded).
    'offer_waivers', (
      SELECT count(*)
      FROM public.offer_waivers ow
      JOIN public.offer_letters ol ON ol.id = ow.offer_letter_id
      WHERE ow.status = 'pending'
        AND ol.lead_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM public.students s
          WHERE s.lead_id = ol.lead_id
            AND (s.login_disabled OR s.archived_at IS NOT NULL OR s.deleted_at IS NOT NULL)
        )
    ),
    -- ABVMU deposit claims awaiting review.
    'abvmu_deposits', (
      SELECT count(*)
      FROM public.abvmu_deposit_claims c
      WHERE c.status = 'pending'
        AND c.lead_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM public.students s
          WHERE s.lead_id = c.lead_id
            AND (s.login_disabled OR s.archived_at IS NOT NULL OR s.deleted_at IS NOT NULL)
        )
    ),
    -- Offer letters awaiting principal approval.
    'offer_approvals', (
      SELECT count(*)
      FROM public.offer_letters ol
      WHERE ol.approval_status = 'pending_principal'
        AND ol.lead_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM public.students s
          WHERE s.lead_id = ol.lead_id
            AND (s.login_disabled OR s.archived_at IS NOT NULL OR s.deleted_at IS NOT NULL)
        )
    ),
    -- Student contact-change requests awaiting review.
    'contact_changes', (
      SELECT count(*)
      FROM public.student_contact_change_requests r
      WHERE r.status = 'pending'
        AND r.student_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM public.students s
          WHERE s.id = r.student_id
            AND (s.login_disabled OR s.archived_at IS NOT NULL OR s.deleted_at IS NOT NULL)
        )
    ),
    -- Submitted applications awaiting review (rows with no lead stay visible).
    'applications', (
      SELECT count(*)
      FROM public.applications a
      WHERE a.status = 'submitted'
        AND (
          a.lead_id IS NULL
          OR NOT EXISTS (
            SELECT 1 FROM public.students s
            WHERE s.lead_id = a.lead_id
              AND (s.login_disabled OR s.archived_at IS NOT NULL OR s.deleted_at IS NOT NULL)
          )
        )
    ),
    -- Today's pending follow-ups.
    'followups', (
      SELECT count(*)
      FROM public.lead_followups f
      WHERE f.status = 'pending'
        AND f.scheduled_at <= date_trunc('day', now()) + interval '1 day'
    ),
    -- WhatsApp conversations with unread inbound messages.
    'whatsapp', (
      SELECT count(*) FROM public.whatsapp_conversations wc WHERE wc.unread_count > 0
    ),
    -- Videos awaiting approval.
    'video_approvals', (
      SELECT count(*) FROM public.videos v WHERE v.status = 'pending_approval'
    ),
    -- Unresolved consultant voice messages.
    'voice_messages', (
      SELECT count(*) FROM public.consultant_voice_messages m WHERE m.status <> 'resolved'
    ),
    -- PGDM certificate approvals.
    'certificate_approvals', (
      SELECT count(*) FROM public.alumni_verification_requests r
      WHERE r.pgdm_certificate_status = 'pending_approval'
    ),
    -- Manual fee concessions awaiting a decision (hidden students excluded).
    'fee_concessions', (
      SELECT count(*)
      FROM public.concessions c
      WHERE c.status IN ('pending_principal', 'pending_super_admin')
        AND c.student_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM public.students s
          WHERE s.id = c.student_id
            AND (s.login_disabled OR s.archived_at IS NOT NULL OR s.deleted_at IS NOT NULL)
        )
    ),
    -- Offer letter edit requests awaiting a decision.
    'offer_edits', (
      SELECT count(*)
      FROM public.offer_letter_edit_requests r
      JOIN public.offer_letters ol ON ol.id = r.offer_letter_id
      WHERE r.status = 'pending'
        AND ol.lead_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM public.students s
          WHERE s.lead_id = ol.lead_id
            AND (s.login_disabled OR s.archived_at IS NOT NULL OR s.deleted_at IS NOT NULL)
        )
    ),
    -- HR letters awaiting approval.
    'hr_document_approvals', (
      SELECT count(*) FROM public.hr_letters h WHERE h.status = 'pending_approval'
    )
  );
$$;

GRANT EXECUTE ON FUNCTION public.get_inbox_counts() TO authenticated;
NOTIFY pgrst, 'reload schema';
