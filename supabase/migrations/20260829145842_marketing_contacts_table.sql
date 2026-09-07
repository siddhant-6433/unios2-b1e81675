-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260829145842 name=marketing_contacts_table applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

CREATE TABLE IF NOT EXISTS public.marketing_contacts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone             text NOT NULL,
  name              text,
  email             text,
  city              text,
  area              text,
  state             text,
  source            text NOT NULL DEFAULT 'import',
  meta              jsonb NOT NULL DEFAULT '{}'::jsonb,
  opted_out         boolean NOT NULL DEFAULT false,
  opted_out_at      timestamptz,
  promoted_lead_id  uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  promoted_at       timestamptz,
  promotion_reason  text,
  last_contacted_at timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS marketing_contacts_phone_key
  ON public.marketing_contacts (public.normalize_lead_phone(phone));

CREATE INDEX IF NOT EXISTS marketing_contacts_promoted
  ON public.marketing_contacts (promoted_lead_id)
  WHERE promoted_lead_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS marketing_contacts_sendable
  ON public.marketing_contacts (id)
  WHERE opted_out = false AND promoted_lead_id IS NULL;

CREATE INDEX IF NOT EXISTS marketing_contacts_created
  ON public.marketing_contacts (created_at DESC);

DROP TRIGGER IF EXISTS trg_marketing_contacts_updated_at ON public.marketing_contacts;
CREATE TRIGGER trg_marketing_contacts_updated_at
  BEFORE UPDATE ON public.marketing_contacts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.marketing_contacts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Marketing staff can view contacts" ON public.marketing_contacts;
CREATE POLICY "Marketing staff can view contacts"
ON public.marketing_contacts
FOR SELECT
TO authenticated
USING (
  public.has_role(auth.uid(), 'super_admin'::app_role)
  OR public.has_role(auth.uid(), 'campus_admin'::app_role)
  OR public.has_role(auth.uid(), 'admission_head'::app_role)
  OR public.has_role(auth.uid(), 'principal'::app_role)
  OR public.has_role(auth.uid(), 'data_entry'::app_role)
  OR public.has_role(auth.uid(), 'counsellor'::app_role)
);

DROP POLICY IF EXISTS "Marketing admins can write contacts" ON public.marketing_contacts;
CREATE POLICY "Marketing admins can write contacts"
ON public.marketing_contacts
FOR ALL
TO authenticated
USING (
  public.has_role(auth.uid(), 'super_admin'::app_role)
  OR public.has_role(auth.uid(), 'campus_admin'::app_role)
  OR public.has_role(auth.uid(), 'admission_head'::app_role)
)
WITH CHECK (
  public.has_role(auth.uid(), 'super_admin'::app_role)
  OR public.has_role(auth.uid(), 'campus_admin'::app_role)
  OR public.has_role(auth.uid(), 'admission_head'::app_role)
);

GRANT SELECT ON public.marketing_contacts TO authenticated;
GRANT ALL    ON public.marketing_contacts TO service_role;

ALTER TABLE public.lead_list_members
  ADD COLUMN IF NOT EXISTS contact_id uuid REFERENCES public.marketing_contacts(id) ON DELETE CASCADE;
ALTER TABLE public.whatsapp_campaign_recipients
  ADD COLUMN IF NOT EXISTS contact_id uuid REFERENCES public.marketing_contacts(id) ON DELETE CASCADE;
ALTER TABLE public.email_campaign_recipients
  ADD COLUMN IF NOT EXISTS contact_id uuid REFERENCES public.marketing_contacts(id) ON DELETE CASCADE;

ALTER TABLE public.lead_list_members
  ADD COLUMN IF NOT EXISTS id uuid NOT NULL DEFAULT gen_random_uuid();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.lead_list_members'::regclass
      AND conname  = 'lead_list_members_pkey'
      AND pg_get_constraintdef(oid) = 'PRIMARY KEY (list_id, lead_id)'
  ) THEN
    ALTER TABLE public.lead_list_members DROP CONSTRAINT lead_list_members_pkey;
    ALTER TABLE public.lead_list_members ADD CONSTRAINT lead_list_members_pkey PRIMARY KEY (id);
  END IF;
END $$;

ALTER TABLE public.lead_list_members            ALTER COLUMN lead_id DROP NOT NULL;
ALTER TABLE public.whatsapp_campaign_recipients ALTER COLUMN lead_id DROP NOT NULL;
ALTER TABLE public.email_campaign_recipients    ALTER COLUMN lead_id DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS lead_list_members_list_lead_uniq
  ON public.lead_list_members (list_id, lead_id) WHERE lead_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS lead_list_members_list_contact_uniq
  ON public.lead_list_members (list_id, contact_id) WHERE contact_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS lead_list_members_contact_idx
  ON public.lead_list_members (contact_id) WHERE contact_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS whatsapp_campaign_recipients_contact_idx
  ON public.whatsapp_campaign_recipients (contact_id) WHERE contact_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS email_campaign_recipients_contact_idx
  ON public.email_campaign_recipients (contact_id) WHERE contact_id IS NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'lead_list_members_one_target') THEN
    ALTER TABLE public.lead_list_members
      ADD CONSTRAINT lead_list_members_one_target
      CHECK ((lead_id IS NOT NULL) <> (contact_id IS NOT NULL)) NOT VALID;
    ALTER TABLE public.lead_list_members VALIDATE CONSTRAINT lead_list_members_one_target;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'whatsapp_campaign_recipients_one_target') THEN
    ALTER TABLE public.whatsapp_campaign_recipients
      ADD CONSTRAINT whatsapp_campaign_recipients_one_target
      CHECK ((lead_id IS NOT NULL) <> (contact_id IS NOT NULL)) NOT VALID;
    ALTER TABLE public.whatsapp_campaign_recipients VALIDATE CONSTRAINT whatsapp_campaign_recipients_one_target;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'email_campaign_recipients_one_target') THEN
    ALTER TABLE public.email_campaign_recipients
      ADD CONSTRAINT email_campaign_recipients_one_target
      CHECK ((lead_id IS NOT NULL) <> (contact_id IS NOT NULL)) NOT VALID;
    ALTER TABLE public.email_campaign_recipients VALIDATE CONSTRAINT email_campaign_recipients_one_target;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.lead_lists_refresh_member_count_ins()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.lead_lists l
     SET member_count = (SELECT count(*) FROM public.lead_list_members m WHERE m.list_id = l.id),
         updated_at   = now()
   WHERE l.id IN (SELECT DISTINCT list_id FROM new_rows);
  RETURN NULL;
END; $$;

CREATE OR REPLACE FUNCTION public.lead_lists_refresh_member_count_del()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.lead_lists l
     SET member_count = (SELECT count(*) FROM public.lead_list_members m WHERE m.list_id = l.id),
         updated_at   = now()
   WHERE l.id IN (SELECT DISTINCT list_id FROM old_rows);
  RETURN NULL;
END; $$;

DROP TRIGGER IF EXISTS trg_lead_list_members_count ON public.lead_list_members;
DROP TRIGGER IF EXISTS trg_lead_list_members_count_ins ON public.lead_list_members;
DROP TRIGGER IF EXISTS trg_lead_list_members_count_del ON public.lead_list_members;

CREATE TRIGGER trg_lead_list_members_count_ins
  AFTER INSERT ON public.lead_list_members
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.lead_lists_refresh_member_count_ins();

CREATE TRIGGER trg_lead_list_members_count_del
  AFTER DELETE ON public.lead_list_members
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.lead_lists_refresh_member_count_del();

DROP FUNCTION IF EXISTS public.lead_lists_refresh_member_count();
