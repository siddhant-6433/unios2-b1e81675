-- WhatsApp Message Classification Queue
-- Holds inbound messages where the regex categorizer returned 'lead' but the
-- message has substance — a worker (wa-classify-message edge fn) processes
-- them via Gemini Flash Lite for nuanced intent detection.
--
-- Cron picks one row at a time every minute and fires the edge function.

CREATE TABLE IF NOT EXISTS public.wa_classification_queue (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id            uuid REFERENCES public.leads(id) ON DELETE CASCADE,
  message_id         uuid REFERENCES public.whatsapp_messages(id) ON DELETE CASCADE,
  phone              text,
  content            text NOT NULL,
  status             text NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending','processing','completed','failed','skipped')),
  attempts           int NOT NULL DEFAULT 0,
  ai_intent          text,        -- 'admission' | 'job' | 'vendor' | 'other'
  ai_confidence      numeric,
  ai_role_inferred   text,
  ai_experience_years numeric,
  ai_reasoning       text,
  applied_category   text,        -- whatever ended up being set on the lead, or null if no action
  dispatch_reply     boolean NOT NULL DEFAULT false, -- true when webhook deferred the AI reply
  scheduled_at       timestamptz NOT NULL DEFAULT now(),
  started_at         timestamptz,
  completed_at       timestamptz,
  error_message      text,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wa_classify_pending
  ON public.wa_classification_queue(status, scheduled_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_wa_classify_lead
  ON public.wa_classification_queue(lead_id);

ALTER TABLE public.wa_classification_queue ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins manage wa_classification_queue" ON public.wa_classification_queue;
CREATE POLICY "Admins manage wa_classification_queue"
  ON public.wa_classification_queue FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'super_admin')
    OR public.has_role(auth.uid(), 'campus_admin')
    OR public.has_role(auth.uid(), 'admission_head')
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'super_admin')
    OR public.has_role(auth.uid(), 'campus_admin')
    OR public.has_role(auth.uid(), 'admission_head')
  );

GRANT ALL ON public.wa_classification_queue TO authenticated;
GRANT ALL ON public.wa_classification_queue TO service_role;

-- ── Cron worker ────────────────────────────────────────────────────────────
-- Picks one pending row, marks processing, fires the edge function via pg_net.
-- Edge fn is responsible for filling the ai_* columns and setting status.
-- If pg_net call itself fails we mark failed and bail.

CREATE OR REPLACE FUNCTION public.fn_process_wa_classification_queue()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_item record;
  v_url  text;
  v_key  text;
BEGIN
  SELECT value INTO v_url FROM _app_config WHERE key = 'supabase_url';
  SELECT value INTO v_key FROM _app_config WHERE key = 'service_role_key';
  IF v_url IS NULL OR v_key IS NULL THEN RETURN; END IF;

  -- Wait at least 90s before the cron picks up a fresh row — the webhook
  -- normally dispatches the classifier directly. This window lets that
  -- dispatch finish before the cron retries. Failed/orphaned rows still
  -- get retried up to 3 times.
  SELECT * INTO v_item
  FROM wa_classification_queue
  WHERE status = 'pending'
    AND scheduled_at <= now()
    AND created_at <= now() - interval '90 seconds'
    AND attempts < 3
  ORDER BY scheduled_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF v_item IS NULL THEN RETURN; END IF;

  UPDATE wa_classification_queue
     SET status     = 'processing',
         started_at = now(),
         attempts   = attempts + 1
   WHERE id = v_item.id;

  BEGIN
    PERFORM net.http_post(
      url := v_url || '/functions/v1/wa-classify-message',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_key
      ),
      body := jsonb_build_object(
        'queue_id', v_item.id,
        'dispatch_reply', v_item.dispatch_reply
      )
    );
    -- Success of pg_net dispatch only — edge fn writes the final status row.
  EXCEPTION WHEN OTHERS THEN
    UPDATE wa_classification_queue
       SET status        = 'failed',
           error_message = 'pg_net dispatch error: ' || SQLERRM,
           completed_at  = now()
     WHERE id = v_item.id;
  END;
END;
$$;

GRANT EXECUTE ON FUNCTION public.fn_process_wa_classification_queue TO service_role;

-- Schedule (every minute, same as ai_call_queue)
SELECT cron.schedule(
  'process-wa-classification-queue',
  '* * * * *',
  $$SELECT public.fn_process_wa_classification_queue()$$
);

-- ── Helper: enqueue a message for classification ───────────────────────────
-- Called from the WhatsApp webhook for ambiguous messages (regex returned 'lead'
-- but message looks employment-ish). Idempotent on (lead_id, message_id).

CREATE UNIQUE INDEX IF NOT EXISTS idx_wa_classify_dedup
  ON public.wa_classification_queue(message_id)
  WHERE message_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.enqueue_wa_classification(
  _lead_id        uuid,
  _message_id     uuid,
  _phone          text,
  _content        text,
  _dispatch_reply boolean DEFAULT false
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF _content IS NULL OR length(trim(_content)) < 6 THEN RETURN NULL; END IF;

  INSERT INTO public.wa_classification_queue (lead_id, message_id, phone, content, dispatch_reply)
  VALUES (_lead_id, _message_id, _phone, _content, _dispatch_reply)
  ON CONFLICT (message_id) DO NOTHING
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.enqueue_wa_classification TO authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_wa_classification TO service_role;

-- ── Helper: does this message contain ANY non-admission signal? ────────────
-- Broad pre-screen used by the webhook to decide whether to defer the AI reply
-- behind LLM classification. False positives are fine (user gets a slightly
-- delayed reply); false negatives are what we cannot afford (would pitch
-- admission to a job applicant).

CREATE OR REPLACE FUNCTION public.wa_message_might_be_non_admission(_text text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT _text IS NOT NULL AND lower(_text) ~* '(vacancy|hiring|naukri|rozgar|kaam\s+(?:chahiye|mil)|recruit|salar(?:y|ies)|ctc|stipend|in[\s-]?hand|\d+\s*lpa|\bcv\b|resume|fresher|opening|walk[\s-]?in|joining|teaching\s+post|faculty\s+post|teacher\s+(?:wanted|required|post|vacancy)|peon|driver|guard|helper|clerk|recept|office\s+boy|nursing\s+staff|lab\s+(?:attendant|assistant)|warden|quotation|\bquote\b|vendor|supplier|wholesale|catalogue|catalog|tie[\s-]?up|partnership|\binvoice\b|gst\s+number|company\s+profile|proposal|\btender\b|distributor|rate[\s-]?card|price[\s-]?list|\bbulk\b|\bjob\b|\bemploy)';
$$;

GRANT EXECUTE ON FUNCTION public.wa_message_might_be_non_admission TO authenticated;
GRANT EXECUTE ON FUNCTION public.wa_message_might_be_non_admission TO service_role;
