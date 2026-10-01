-- HR security hardening (P0).
--
-- 1. Stop an employee editing HR-only columns of their own employee_profiles
--    row directly through PostgREST. Row-level policies cannot restrict columns,
--    so a BEFORE UPDATE trigger enforces the allow-list. HR editors and
--    server-side callers are unaffected.
-- 2. Remove client EXECUTE on the HR document helpers that had no permission
--    check, so any authenticated user can no longer forge audit rows or spam
--    super-admin notifications. The SECURITY DEFINER RPCs that legitimately
--    call them still can (they execute as the owner).
-- 3. Stop a `hr:documents_generate` user mutating or deleting an
--    already-approved/issued letter through PostgREST. The approval RPCs are
--    SECURITY DEFINER and bypass RLS, so the workflow still works.

-- ── 1. Column-level self-update guard ──────────────────────────────────────

CREATE OR REPLACE FUNCTION public.guard_employee_self_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_allowed text[] := public.employee_self_editable_fields();
  v_before  jsonb;
  v_after   jsonb;
BEGIN
  -- Server-side callers (cron, edge functions, service_role) have no JWT uid.
  IF auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- HR editors may change anything.
  IF public.has_permission(auth.uid(), 'hr:employees_edit') THEN
    RETURN NEW;
  END IF;

  -- Only constrain a user editing their own row. Other rows remain governed by RLS.
  IF OLD.user_id IS DISTINCT FROM auth.uid() THEN
    RETURN NEW;
  END IF;

  -- Everything except the self-editable allow-list and the audit timestamp must
  -- stay identical.
  v_before := to_jsonb(OLD) - v_allowed - 'updated_at';
  v_after  := to_jsonb(NEW) - v_allowed - 'updated_at';

  IF v_before IS DISTINCT FROM v_after THEN
    RAISE EXCEPTION
      'Only your personal and contact details can be edited directly. Submit a profile change request for anything else.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_employee_self_update ON public.employee_profiles;
CREATE TRIGGER trg_guard_employee_self_update
  BEFORE UPDATE ON public.employee_profiles
  FOR EACH ROW EXECUTE FUNCTION public.guard_employee_self_update();

COMMENT ON FUNCTION public.guard_employee_self_update() IS
  'Rejects direct self-service edits to HR-owned employee_profiles columns; employees must use employee_profile_change_requests.';

-- ── 2. Gate the HR document helpers ────────────────────────────────────────
-- These have no internal permission check; they are only safe to call from the
-- SECURITY DEFINER approval RPCs (which run as the owner and keep EXECUTE).

REVOKE EXECUTE ON FUNCTION public.log_hr_document_action(uuid, text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.notify_super_admins_hr_document(uuid, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.log_hr_document_action(uuid, text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.notify_super_admins_hr_document(uuid, text, text) TO service_role;

-- ── 3. hr_letters: split FOR ALL into status-aware policies ────────────────
-- The approval/issue RPCs are SECURITY DEFINER, so they are not affected.

DROP POLICY IF EXISTS "HR reads letters" ON public.hr_letters;

DROP POLICY IF EXISTS "HR selects letters" ON public.hr_letters;
CREATE POLICY "HR selects letters"
  ON public.hr_letters FOR SELECT TO authenticated
  USING (
    (SELECT public.has_permission(auth.uid(), 'hr:employees_edit'))
    OR (SELECT public.has_permission(auth.uid(), 'hr:documents_generate'))
  );

DROP POLICY IF EXISTS "HR inserts letters" ON public.hr_letters;
CREATE POLICY "HR inserts letters"
  ON public.hr_letters FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT public.has_permission(auth.uid(), 'hr:employees_edit'))
    OR (SELECT public.has_permission(auth.uid(), 'hr:documents_generate'))
  );

-- A generator may edit while a letter is still a draft / awaiting approval, but
-- cannot post an update that lands it in a terminal state, and cannot touch an
-- already approved/issued letter.
DROP POLICY IF EXISTS "HR updates pending letters" ON public.hr_letters;
CREATE POLICY "HR updates pending letters"
  ON public.hr_letters FOR UPDATE TO authenticated
  USING (
    (
      (SELECT public.has_permission(auth.uid(), 'hr:employees_edit'))
      OR (SELECT public.has_permission(auth.uid(), 'hr:documents_generate'))
    )
    AND status IN ('draft', 'pending_approval', 'rejected')
  )
  WITH CHECK (
    (
      (SELECT public.has_permission(auth.uid(), 'hr:employees_edit'))
      OR (SELECT public.has_permission(auth.uid(), 'hr:documents_generate'))
    )
    AND status IN ('draft', 'pending_approval', 'rejected')
  );

DROP POLICY IF EXISTS "HR deletes draft letters" ON public.hr_letters;
CREATE POLICY "HR deletes draft letters"
  ON public.hr_letters FOR DELETE TO authenticated
  USING (
    (
      (SELECT public.has_permission(auth.uid(), 'hr:employees_edit'))
      OR (SELECT public.has_permission(auth.uid(), 'hr:documents_generate'))
    )
    AND status IN ('draft', 'rejected')
  );

-- ── 4. Let HR (not only super_admin) action face registrations ─────────────

DROP POLICY IF EXISTS "HR reviews face registrations" ON public.employee_face_registrations;
CREATE POLICY "HR reviews face registrations"
  ON public.employee_face_registrations FOR UPDATE TO authenticated
  USING ((SELECT public.has_permission(auth.uid(), 'hr:attendance_edit')))
  WITH CHECK ((SELECT public.has_permission(auth.uid(), 'hr:attendance_edit')));
