-- Photo Day async pipeline:
--   * photo_day:capture / photo_day:assign permissions
--   * principal/super_admin can assign capture to any campus staff user
--   * students.photo_original_url / photo_processed_url
--   * student_photo_jobs queue + cron worker kick
--
-- Capture path writes original immediately to photo_url, enqueues AI job.
-- Worker auto-flips photo_url to processed on success.

-- ---------------------------------------------------------------------------
-- 1. Permissions
-- ---------------------------------------------------------------------------
INSERT INTO public.permissions (module, action, description) VALUES
  ('photo_day', 'capture', 'Capture student ID photos on Photo Day (mobile/web)'),
  ('photo_day', 'assign',  'Grant or revoke Photo Day capture for other staff')
ON CONFLICT (module, action) DO UPDATE
SET description = EXCLUDED.description;

-- super_admin + principal get both by default
INSERT INTO public.role_permissions (role, permission_id)
SELECT r.role::public.app_role, p.id
FROM public.permissions p
CROSS JOIN (VALUES ('super_admin'), ('principal')) AS r(role)
WHERE p.module = 'photo_day' AND p.action IN ('capture', 'assign')
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2. Helpers
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_capture_student_photos(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    _user_id IS NOT NULL
    AND (
      public.has_role(_user_id, 'super_admin'::public.app_role)
      OR 'photo_day:capture' = ANY(public.get_user_permissions(_user_id))
    );
$$;

COMMENT ON FUNCTION public.can_capture_student_photos(uuid) IS
  'True when the user may capture student ID photos (role default or assigned override).';

CREATE OR REPLACE FUNCTION public.can_assign_photo_day(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    _user_id IS NOT NULL
    AND (
      public.has_role(_user_id, 'super_admin'::public.app_role)
      OR public.has_role(_user_id, 'principal'::public.app_role)
      OR 'photo_day:assign' = ANY(public.get_user_permissions(_user_id))
    );
$$;

COMMENT ON FUNCTION public.can_assign_photo_day(uuid) IS
  'True when the user may grant/revoke Photo Day capture for other staff.';

GRANT EXECUTE ON FUNCTION public.can_capture_student_photos(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_assign_photo_day(uuid) TO authenticated, service_role;

-- Assign / revoke photo_day:capture for a target user (campus-scoped for principal)
CREATE OR REPLACE FUNCTION public.assign_photo_day(
  _target_user_id uuid,
  _granted boolean
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_perm_id uuid;
  v_target_campus uuid;
  v_actor_is_sa boolean;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF NOT public.can_assign_photo_day(v_actor) THEN
    RAISE EXCEPTION 'Not allowed to assign Photo Day';
  END IF;

  IF _target_user_id IS NULL THEN
    RAISE EXCEPTION 'target user is required';
  END IF;

  SELECT id INTO v_perm_id
  FROM public.permissions
  WHERE module = 'photo_day' AND action = 'capture';

  IF v_perm_id IS NULL THEN
    RAISE EXCEPTION 'photo_day:capture permission is not registered';
  END IF;

  v_actor_is_sa := public.has_role(v_actor, 'super_admin'::public.app_role);

  IF NOT v_actor_is_sa THEN
    -- Principal (or photo_day:assign holder): only staff in an accessible campus
    SELECT p.campus_id INTO v_target_campus
    FROM public.profiles p
    WHERE p.user_id = _target_user_id;

    IF v_target_campus IS NULL THEN
      RAISE EXCEPTION 'Target user has no campus set';
    END IF;

    IF NOT public.user_can_access_assigned_campus(v_actor, v_target_campus) THEN
      RAISE EXCEPTION 'Target user is outside your campus';
    END IF;
  END IF;

  INSERT INTO public.user_permission_overrides (user_id, permission_id, granted, granted_by)
  VALUES (_target_user_id, v_perm_id, _granted, v_actor)
  ON CONFLICT (user_id, permission_id) DO UPDATE
  SET granted = EXCLUDED.granted,
      granted_by = EXCLUDED.granted_by,
      created_at = now();

  -- If revoking, keep the row as granted=false so role defaults don't re-enable
  -- (principals/super_admin still have role defaults; overrides only matter for others)

  RETURN jsonb_build_object(
    'ok', true,
    'user_id', _target_user_id,
    'granted', _granted,
    'permission', 'photo_day:capture'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.assign_photo_day(uuid, boolean) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Student photo columns
-- ---------------------------------------------------------------------------
ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS photo_original_url text,
  ADD COLUMN IF NOT EXISTS photo_processed_url text;

COMMENT ON COLUMN public.students.photo_original_url IS
  'Raw Photo Day capture URL (always kept; printable fallback).';
COMMENT ON COLUMN public.students.photo_processed_url IS
  'Last successful AI white-background photo URL.';
COMMENT ON COLUMN public.students.photo_url IS
  'Canonical display/print URL: processed when available, else original.';

-- ---------------------------------------------------------------------------
-- 4. Job queue
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.student_photo_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  original_path text NOT NULL,
  original_url text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'cancelled')),
  attempts integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 3,
  last_error text,
  model text,
  processed_path text,
  processed_url text,
  requested_by uuid REFERENCES auth.users(id),
  campus_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz,
  next_attempt_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_student_photo_jobs_pending
  ON public.student_photo_jobs (next_attempt_at, created_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_student_photo_jobs_student
  ON public.student_photo_jobs (student_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_student_photo_jobs_processing_stale
  ON public.student_photo_jobs (started_at)
  WHERE status = 'processing';

ALTER TABLE public.student_photo_jobs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Photo day staff can read photo jobs" ON public.student_photo_jobs;
CREATE POLICY "Photo day staff can read photo jobs"
  ON public.student_photo_jobs FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin'::public.app_role)
    OR public.can_capture_student_photos(auth.uid())
    OR public.can_assign_photo_day(auth.uid())
  );

-- Writes go through service role / edge functions only
DROP POLICY IF EXISTS "Service role manages photo jobs" ON public.student_photo_jobs;
-- No authenticated write policy — edge uses service role

GRANT SELECT ON public.student_photo_jobs TO authenticated;
GRANT ALL ON public.student_photo_jobs TO service_role;

-- Cancel older pending jobs for a student when a new capture lands
CREATE OR REPLACE FUNCTION public.cancel_pending_student_photo_jobs(_student_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE public.student_photo_jobs
  SET status = 'cancelled',
      completed_at = now(),
      last_error = coalesce(last_error, 'Superseded by newer capture')
  WHERE student_id = _student_id
    AND status IN ('pending', 'processing');
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

GRANT EXECUTE ON FUNCTION public.cancel_pending_student_photo_jobs(uuid) TO service_role;

-- Claim due jobs for the worker (SKIP LOCKED)
CREATE OR REPLACE FUNCTION public.claim_student_photo_jobs(_limit integer DEFAULT 4)
RETURNS SETOF public.student_photo_jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_limit integer := least(greatest(coalesce(_limit, 4), 1), 12);
BEGIN
  -- Reclaim stuck processing (> 5 minutes)
  UPDATE public.student_photo_jobs
  SET status = 'pending',
      next_attempt_at = now(),
      last_error = coalesce(last_error, 'Reclaimed stale processing lock')
  WHERE status = 'processing'
    AND started_at IS NOT NULL
    AND started_at < now() - interval '5 minutes';

  RETURN QUERY
  WITH due AS (
    SELECT j.id
    FROM public.student_photo_jobs j
    WHERE j.status = 'pending'
      AND j.next_attempt_at <= now()
      AND j.attempts < j.max_attempts
    ORDER BY j.next_attempt_at ASC, j.created_at ASC
    LIMIT v_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.student_photo_jobs j
  SET status = 'processing',
      started_at = now(),
      attempts = j.attempts + 1
  FROM due
  WHERE j.id = due.id
  RETURNING j.*;
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_student_photo_jobs(integer) TO service_role;

-- Cron tick: HTTP-kick the worker edge function
CREATE OR REPLACE FUNCTION public.fn_process_student_photo_jobs()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_url text;
  v_key text;
BEGIN
  SELECT value INTO v_url FROM public._app_config WHERE key = 'supabase_url';
  SELECT value INTO v_key FROM public._app_config WHERE key = 'service_role_key';
  IF v_url IS NULL OR v_key IS NULL THEN
    RETURN;
  END IF;

  -- Only fire if there is work
  IF NOT EXISTS (
    SELECT 1 FROM public.student_photo_jobs
    WHERE status = 'pending' AND next_attempt_at <= now()
    LIMIT 1
  ) AND NOT EXISTS (
    SELECT 1 FROM public.student_photo_jobs
    WHERE status = 'processing' AND started_at < now() - interval '5 minutes'
    LIMIT 1
  ) THEN
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := v_url || '/functions/v1/process-student-photo-jobs',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body := jsonb_build_object('limit', 6)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_process_student_photo_jobs() TO service_role;

-- Schedule every minute (idempotent re-schedule)
DO $sched$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'process-student-photo-jobs') THEN
    PERFORM cron.unschedule('process-student-photo-jobs');
  END IF;
  PERFORM cron.schedule(
    'process-student-photo-jobs',
    '* * * * *',
    'SELECT public.fn_process_student_photo_jobs()'
  );
EXCEPTION
  WHEN undefined_table THEN
    RAISE NOTICE 'cron.job not available; schedule process-student-photo-jobs manually';
  WHEN OTHERS THEN
    RAISE NOTICE 'Could not schedule process-student-photo-jobs: %', SQLERRM;
END;
$sched$;
