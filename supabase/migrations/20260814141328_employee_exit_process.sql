-- The exit process, matching the shape Keka uses:
--
--   Under review  → resignation or termination recorded, awaiting approval
--   In progress   → approved, serving notice
--   Exited        → last working day has passed; access revoked, archived
--   Reverted      → the exit was called off and the person stays
--
-- The previous table jumped straight to in_progress, so there was nowhere to
-- record a resignation that HR had not yet accepted, and no notion of notice.

ALTER TABLE public.employee_exits
  -- Snapshot of the contractual notice at the time of resigning. Read from the
  -- employee's notice_period_days, but kept here because the contract can change
  -- later and a settled exit must not silently recompute.
  ADD COLUMN IF NOT EXISTS notice_period_days        integer,
  ADD COLUMN IF NOT EXISTS expected_last_working_day date,
  ADD COLUMN IF NOT EXISTS approved_by               uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS approved_at               timestamptz,
  ADD COLUMN IF NOT EXISTS rejected_reason           text;

-- Widen the state machine. The old CHECK only knew in_progress/completed/reverted.
ALTER TABLE public.employee_exits DROP CONSTRAINT IF EXISTS employee_exits_status_check;
ALTER TABLE public.employee_exits
  ADD CONSTRAINT employee_exits_status_check
  CHECK (status IN ('under_review', 'in_progress', 'completed', 'reverted', 'rejected'));

ALTER TABLE public.employee_exits ALTER COLUMN status SET DEFAULT 'under_review';

CREATE INDEX IF NOT EXISTS employee_exits_status_idx
  ON public.employee_exits (status, last_working_day DESC);

-- ── Raising an exit ────────────────────────────────────────────────────
-- Computes the expected last working day from the employee's notice period, so
-- HR does not do date arithmetic by hand and the default matches the contract.
CREATE OR REPLACE FUNCTION public.raise_employee_exit(
  _employee_profile_id uuid,
  _exit_type           text,
  _resignation_date    date,
  _reason              text DEFAULT NULL,
  _last_working_day    date DEFAULT NULL,
  _notice_waived       boolean DEFAULT false
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_notice   integer;
  v_expected date;
  v_id       uuid;
BEGIN
  IF NOT public.has_permission(auth.uid(), 'hr:employees_edit') THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  SELECT COALESCE(notice_period_days, 0) INTO v_notice
    FROM public.employee_profiles WHERE id = _employee_profile_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Employee not found'; END IF;

  -- Waiving notice means today; otherwise resignation date + contractual notice.
  v_expected := CASE
    WHEN _notice_waived THEN _resignation_date
    ELSE _resignation_date + (v_notice || ' days')::interval
  END::date;

  INSERT INTO public.employee_exits (
    employee_profile_id, exit_type, resignation_date, reason,
    notice_period_days, expected_last_working_day,
    last_working_day, notice_waived, status, created_by
  ) VALUES (
    _employee_profile_id, _exit_type, _resignation_date, _reason,
    v_notice, v_expected,
    COALESCE(_last_working_day, v_expected), _notice_waived,
    'under_review', auth.uid()
  )
  -- One exit per employee. Re-raising after a revert reopens the same row rather
  -- than failing, so a called-off resignation can be re-submitted.
  ON CONFLICT (employee_profile_id) DO UPDATE SET
    exit_type = EXCLUDED.exit_type,
    resignation_date = EXCLUDED.resignation_date,
    reason = EXCLUDED.reason,
    notice_period_days = EXCLUDED.notice_period_days,
    expected_last_working_day = EXCLUDED.expected_last_working_day,
    last_working_day = EXCLUDED.last_working_day,
    notice_waived = EXCLUDED.notice_waived,
    status = 'under_review',
    approved_by = NULL, approved_at = NULL, rejected_reason = NULL,
    updated_at = now()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

-- ── Archiving on exit ──────────────────────────────────────────────────
-- Completing an exit must also cut off access. `archived_at` and `login_disabled`
-- already exist on profiles for exactly this (20260619112000, 20260605000000), so
-- this reuses them rather than inventing a parallel "employee is gone" flag that
-- the Admin Panel would not know about.
CREATE OR REPLACE FUNCTION public.sync_employee_exit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_user uuid;
BEGIN
  SELECT user_id INTO v_user FROM public.employee_profiles WHERE id = NEW.employee_profile_id;

  IF NEW.status = 'completed' AND NEW.last_working_day IS NOT NULL THEN
    UPDATE public.employee_profiles
       SET date_of_exit = NEW.last_working_day,
           employment_status = CASE
             WHEN NEW.exit_type = 'termination' THEN 'Terminated'
             ELSE 'Resigned' END
     WHERE id = NEW.employee_profile_id;

    -- Revoke access only once the last working day has actually arrived; somebody
    -- serving notice still needs to log in.
    IF v_user IS NOT NULL AND NEW.last_working_day <= CURRENT_DATE THEN
      UPDATE public.profiles
         SET archived_at = COALESCE(archived_at, now()),
             archived_by = auth.uid(),
             login_disabled = true
       WHERE user_id = v_user;
    END IF;

  ELSIF NEW.status = 'in_progress' THEN
    -- Approved and serving notice: the exit date is known, but they are still staff.
    UPDATE public.employee_profiles
       SET employment_status = 'On Notice'
     WHERE id = NEW.employee_profile_id;

  ELSIF NEW.status = 'reverted' THEN
    UPDATE public.employee_profiles
       SET date_of_exit = NULL, employment_status = 'Working'
     WHERE id = NEW.employee_profile_id;

    IF v_user IS NOT NULL THEN
      UPDATE public.profiles
         SET archived_at = NULL, archived_by = NULL, login_disabled = false
       WHERE user_id = v_user;
    END IF;
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS employee_exits_sync ON public.employee_exits;
CREATE TRIGGER employee_exits_sync
  AFTER INSERT OR UPDATE OF status, last_working_day ON public.employee_exits
  FOR EACH ROW EXECUTE FUNCTION public.sync_employee_exit();

-- ── Sweep exits whose last working day has passed ──────────────────────
-- Keka's "Exited employees" bucket is defined by the date passing, not by somebody
-- remembering to click. This closes out anyone serving notice whose day has come.
CREATE OR REPLACE FUNCTION public.close_due_employee_exits()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_count integer := 0;
BEGIN
  IF NOT public.has_permission(auth.uid(), 'hr:employees_edit') THEN
    RAISE EXCEPTION 'Forbidden';
  END IF;

  UPDATE public.employee_exits
     SET status = 'completed', updated_at = now()
   WHERE status = 'in_progress'
     AND last_working_day IS NOT NULL
     AND last_working_day <= CURRENT_DATE;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.raise_employee_exit(uuid, text, date, text, date, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_due_employee_exits() TO authenticated;
REVOKE ALL ON FUNCTION public.sync_employee_exit() FROM PUBLIC;
