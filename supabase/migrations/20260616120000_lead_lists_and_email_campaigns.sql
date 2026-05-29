-- Lead Lists + Email Campaigns
--
-- A "lead list" is a named, static collection of lead_ids (built from a CSV
-- import, a saved filter snapshot, or a manual multi-select) that can be
-- targeted by bulk WhatsApp or email campaigns. We keep lists static for
-- predictability — recipient count at preview time matches send time.
--
-- WhatsApp campaigns already exist (whatsapp_campaigns). We add a list_id
-- pointer so a campaign can be tied back to the list it was sent from.
-- Email campaigns get a parallel pair of tables.

CREATE TABLE public.lead_lists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'import', 'filter')),
  filters_snapshot jsonb DEFAULT '{}',
  member_count integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.lead_list_members (
  list_id uuid NOT NULL REFERENCES public.lead_lists(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  added_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (list_id, lead_id)
);

CREATE INDEX idx_lead_list_members_lead ON public.lead_list_members(lead_id);
CREATE INDEX idx_lead_lists_created_at ON public.lead_lists(created_at DESC);

ALTER TABLE public.lead_lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lead_list_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage lead_lists"
  ON public.lead_lists FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can manage lead_list_members"
  ON public.lead_list_members FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Keep member_count in sync. Cheap trigger; lists are bulk-loaded so the
-- write amplification is tolerable, and the count is read on every list
-- card render.
CREATE OR REPLACE FUNCTION public.lead_lists_refresh_member_count()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_id uuid;
BEGIN
  target_id := COALESCE(NEW.list_id, OLD.list_id);
  UPDATE public.lead_lists
     SET member_count = (
       SELECT count(*) FROM public.lead_list_members WHERE list_id = target_id
     ),
     updated_at = now()
   WHERE id = target_id;
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_lead_list_members_count
AFTER INSERT OR DELETE ON public.lead_list_members
FOR EACH ROW EXECUTE FUNCTION public.lead_lists_refresh_member_count();

-- Tie WhatsApp campaigns back to the list they were sent from (nullable so
-- the legacy filter-driven campaign rows still validate).
ALTER TABLE public.whatsapp_campaigns
  ADD COLUMN IF NOT EXISTS list_id uuid REFERENCES public.lead_lists(id) ON DELETE SET NULL;

-- Email campaigns — mirror of whatsapp_campaigns.
CREATE TABLE public.email_campaigns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  template_slug text,
  custom_subject text,
  custom_body text,
  list_id uuid REFERENCES public.lead_lists(id) ON DELETE SET NULL,
  total_recipients integer DEFAULT 0,
  sent_count integer DEFAULT 0,
  failed_count integer DEFAULT 0,
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'sending', 'completed', 'failed')),
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz DEFAULT now(),
  completed_at timestamptz,
  -- Either a template_slug or a (custom_subject, custom_body) pair must be set.
  CHECK (template_slug IS NOT NULL OR (custom_subject IS NOT NULL AND custom_body IS NOT NULL))
);

CREATE TABLE public.email_campaign_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  campaign_id uuid NOT NULL REFERENCES public.email_campaigns(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  to_email text NOT NULL,
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed', 'skipped')),
  provider_id text,
  error_message text,
  sent_at timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_email_campaign_recipients_campaign ON public.email_campaign_recipients(campaign_id);
CREATE INDEX idx_email_campaign_recipients_status ON public.email_campaign_recipients(campaign_id, status);

ALTER TABLE public.email_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_campaign_recipients ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can manage email_campaigns"
  ON public.email_campaigns FOR ALL TO authenticated USING (true) WITH CHECK (true);
CREATE POLICY "Authenticated users can manage email_campaign_recipients"
  ON public.email_campaign_recipients FOR ALL TO authenticated USING (true) WITH CHECK (true);
