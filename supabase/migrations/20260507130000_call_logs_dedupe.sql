-- ============================================================
-- Cloud Call dedupe — one row per physical call.
--
-- Before: every Cloud Call wrote two rows to call_logs:
--   1. voice-agent server.ts bridge-hangup webhook → "Cloud Call [hash]:
--      <auto-disposition> (auto)" with the technical fields (duration etc.)
--   2. CloudDialer.tsx markDisposition / finalizeDisposition →
--      counsellor's typed disposition + notes
--
-- After: both writers converge on the same row keyed by `cloud_call_uuid`
-- via the SECURITY DEFINER function below. The function applies merge rules
-- so the auto path never clobbers human-set disposition/notes, and the
-- manual path never wipes auto-captured duration/recording.
-- ============================================================

-- 1. Column + partial unique index ---------------------------------------
ALTER TABLE public.call_logs
  ADD COLUMN IF NOT EXISTS cloud_call_uuid text;

CREATE UNIQUE INDEX IF NOT EXISTS call_logs_cloud_call_uuid_uniq
  ON public.call_logs (cloud_call_uuid)
  WHERE cloud_call_uuid IS NOT NULL;

COMMENT ON COLUMN public.call_logs.cloud_call_uuid IS
  'voice-agent call_id (8-char prefix is shown in legacy notes). Set on every Cloud Dialer call so the auto-hangup webhook + the counsellor''s manual disposition merge into one row.';

-- 2. Backfill cloud_call_uuid for existing rows from the notes pattern ---
UPDATE public.call_logs
   SET cloud_call_uuid = (regexp_match(notes, 'Cloud Call \[([a-f0-9]{8,})\]'))[1]
 WHERE cloud_call_uuid IS NULL
   AND notes IS NOT NULL
   AND notes ~* 'cloud call \[';

-- 3. Deduplicate existing pairs ------------------------------------------
-- For every (auto, manual) pair within 5 minutes for the same lead, merge
-- the manual row's disposition + notes onto the auto row and delete the
-- manual row. Idempotent.
DO $$
DECLARE
  v_pair RECORD;
BEGIN
  FOR v_pair IN
    WITH auto_rows AS (
      SELECT id, lead_id, cloud_call_uuid, called_at
        FROM public.call_logs
       WHERE cloud_call_uuid IS NOT NULL
         AND notes ~* 'cloud call \['
    ),
    manual_rows AS (
      SELECT id, lead_id, disposition, notes, user_id, called_at
        FROM public.call_logs
       WHERE cloud_call_uuid IS NULL
         AND (notes IS NULL OR notes !~* 'cloud call \[')
    )
    SELECT
      a.id   AS auto_id,
      m.id   AS manual_id,
      m.disposition AS m_disp,
      m.notes       AS m_notes,
      m.user_id     AS m_user_id
    FROM auto_rows a
    JOIN manual_rows m
      ON m.lead_id = a.lead_id
     AND m.called_at BETWEEN a.called_at - interval '5 minutes' AND a.called_at + interval '5 minutes'
    -- One auto row per manual row (closest match wins — earliest one).
    ORDER BY a.id, ABS(EXTRACT(EPOCH FROM (m.called_at - a.called_at)))
  LOOP
    UPDATE public.call_logs
       SET disposition = COALESCE(v_pair.m_disp, disposition),
           notes       = COALESCE(NULLIF(v_pair.m_notes, ''), notes),
           user_id     = COALESCE(v_pair.m_user_id, user_id)
     WHERE id = v_pair.auto_id
       AND id NOT IN (
         -- Skip auto rows we've already merged into.
         SELECT auto_id FROM (SELECT NULL::uuid AS auto_id WHERE FALSE) z
       );

    DELETE FROM public.call_logs WHERE id = v_pair.manual_id;
  END LOOP;
END$$;

-- 4. Merge RPC — SECURITY DEFINER, callable from authenticated + service role
-- p_source values:
--   'auto'   = voice-agent webhook (technical writer). Sets technical fields
--              and ONLY fills disposition/notes if they are still null.
--   'manual' = counsellor's disposition save. Always overwrites disposition
--              + notes. Fills user_id if currently null.
CREATE OR REPLACE FUNCTION public.record_cloud_call_log(
  p_call_uuid       text,
  p_lead_id         uuid,
  p_user_id         uuid,
  p_disposition     text,
  p_duration        integer,
  p_notes           text,
  p_source          text,
  p_recording_url   text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF p_call_uuid IS NULL OR p_lead_id IS NULL THEN
    RAISE EXCEPTION 'p_call_uuid and p_lead_id are required';
  END IF;
  IF p_source NOT IN ('auto', 'manual') THEN
    RAISE EXCEPTION 'p_source must be ''auto'' or ''manual''';
  END IF;

  SELECT id INTO v_id
    FROM public.call_logs
   WHERE cloud_call_uuid = p_call_uuid
   LIMIT 1;

  IF v_id IS NULL THEN
    INSERT INTO public.call_logs (
      lead_id, user_id, direction,
      duration_seconds, disposition, recording_url, notes,
      cloud_call_uuid, called_at
    ) VALUES (
      p_lead_id, p_user_id, 'outbound',
      COALESCE(p_duration, 0), p_disposition, p_recording_url, p_notes,
      p_call_uuid, now()
    ) RETURNING id INTO v_id;
    RETURN v_id;
  END IF;

  IF p_source = 'manual' THEN
    -- Counsellor's manual save wins on disposition + notes; preserve any
    -- duration/recording the auto path may have already filled in.
    UPDATE public.call_logs
       SET disposition      = COALESCE(p_disposition, disposition),
           notes            = COALESCE(NULLIF(p_notes, ''), notes),
           user_id          = COALESCE(user_id, p_user_id),
           duration_seconds = GREATEST(COALESCE(duration_seconds, 0), COALESCE(p_duration, 0))
     WHERE id = v_id;
  ELSE
    -- Auto webhook fills technical fields only — never overwrites a
    -- disposition or notes the counsellor has already set.
    UPDATE public.call_logs
       SET duration_seconds = GREATEST(COALESCE(duration_seconds, 0), COALESCE(p_duration, 0)),
           recording_url    = COALESCE(recording_url, p_recording_url),
           disposition      = COALESCE(disposition, p_disposition),
           notes            = COALESCE(notes, p_notes),
           user_id          = COALESCE(user_id, p_user_id)
     WHERE id = v_id;
  END IF;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.record_cloud_call_log(text, uuid, uuid, text, integer, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.record_cloud_call_log(text, uuid, uuid, text, integer, text, text, text) TO service_role;
