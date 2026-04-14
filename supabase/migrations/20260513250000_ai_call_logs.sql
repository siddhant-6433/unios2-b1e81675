-- AI Call Logs table — stores call metadata, recordings, and transcriptions
CREATE TABLE IF NOT EXISTS public.ai_call_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  call_uuid text,                    -- Plivo CallUUID
  direction text NOT NULL DEFAULT 'outbound' CHECK (direction IN ('outbound', 'inbound')),
  from_number text,
  to_number text,
  status text,                        -- completed, busy, no-answer, failed
  duration_seconds int DEFAULT 0,
  recording_url text,                 -- Plivo recording URL
  recording_duration int,
  bill_duration int,
  bill_cost numeric(10,5),
  hangup_cause text,
  caller_transcript text,             -- what the caller said (aggregated)
  ai_transcript text,                 -- what the AI said (aggregated)
  tool_calls_made jsonb DEFAULT '[]', -- [{name, args, result}]
  initiated_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_ai_call_logs_lead ON public.ai_call_logs(lead_id);
CREATE INDEX idx_ai_call_logs_created ON public.ai_call_logs(created_at DESC);

ALTER TABLE public.ai_call_logs ENABLE ROW LEVEL SECURITY;

-- Super admin, principal, admission_head can see all
CREATE POLICY "Admins can view ai_call_logs"
  ON public.ai_call_logs FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'super_admin')
    OR has_role(auth.uid(), 'principal')
    OR has_role(auth.uid(), 'admission_head')
    OR has_role(auth.uid(), 'campus_admin')
  );

-- Counsellors can see calls for their leads
CREATE POLICY "Counsellors can view own lead ai_calls"
  ON public.ai_call_logs FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM leads l
      JOIN profiles p ON p.id = l.counsellor_id
      WHERE l.id = ai_call_logs.lead_id AND p.user_id = auth.uid()
    )
  );

-- Service role / system can insert
CREATE POLICY "System can insert ai_call_logs"
  ON public.ai_call_logs FOR INSERT TO authenticated
  WITH CHECK (true);

CREATE POLICY "System can update ai_call_logs"
  ON public.ai_call_logs FOR UPDATE TO authenticated
  USING (true);

GRANT SELECT, INSERT, UPDATE ON public.ai_call_logs TO authenticated;
GRANT ALL ON public.ai_call_logs TO service_role;
