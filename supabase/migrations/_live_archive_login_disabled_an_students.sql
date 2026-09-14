-- Archive the 8 login-disabled students who already have an admission number.
-- Keep login_disabled and ANs. Do not fire archive_student (needs auth.uid()).

WITH pans AS (
  SELECT unnest(ARRAY[
    'PAN-4FEB60CA',
    'PAN-4CBA1B04',
    'PAN-DAEB658E',
    'PAN-F5158FED',
    'PAN-FB730E24',
    'PAN-A03AD820',
    'PAN-F6D8E919',
    'PAN-E27CD347'
  ]) AS pre_admission_no
),
targets AS (
  SELECT s.id, s.status::text AS old_status
    FROM public.students s
    JOIN pans p ON p.pre_admission_no = s.pre_admission_no
   WHERE COALESCE(s.login_disabled, false)
     AND s.admission_no IS NOT NULL
     AND s.archived_at IS NULL
),
upd AS (
  UPDATE public.students s
     SET archived_at = now(),
         archive_reason = 'Login disabled — archived so candidate communications stay off',
         status = 'inactive'
    FROM targets t
   WHERE s.id = t.id
  RETURNING s.id, t.old_status
)
INSERT INTO public.student_audit_log (
  student_id, actor_user_id, event_type, field_name, old_value, new_value, reason
)
SELECT id, NULL, 'archived', 'status', old_status, 'inactive',
       'Login disabled — archived so candidate communications stay off'
  FROM upd;

UPDATE public.student_magic_tokens t
   SET expires_at = now()
 WHERE t.expires_at > now()
   AND t.student_id IN (
     SELECT s.id
       FROM public.students s
      WHERE s.pre_admission_no = ANY (ARRAY[
        'PAN-4FEB60CA','PAN-4CBA1B04','PAN-DAEB658E','PAN-F5158FED',
        'PAN-FB730E24','PAN-A03AD820','PAN-F6D8E919','PAN-E27CD347'
      ])
   );

-- Kick any already-open student-portal sessions.
SELECT public.admin_revoke_user_sessions(s.user_id)
  FROM public.students s
 WHERE s.user_id IS NOT NULL
   AND s.pre_admission_no = ANY (ARRAY[
     'PAN-4FEB60CA','PAN-4CBA1B04','PAN-DAEB658E','PAN-F5158FED',
     'PAN-FB730E24','PAN-A03AD820','PAN-F6D8E919','PAN-E27CD347'
   ]);
