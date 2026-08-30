-- Split raw imported marketing data out of `leads` into `marketing_contacts`.
--
-- WHY: as of 2026-08-29 `leads` held 492,876 rows (906 MB heap + ~700 MB across
-- 41 indexes) of which only 28,449 (5.8%) had ANY engagement — a WhatsApp
-- message, an AI call record, an application or a student. The other 464,515
-- were bulk-imported marketing contacts (Gurgaon/NCR society lists, senior
-- citizen directories, doctor directories) that no counsellor ever works.
-- They inflated every counsellor index ~17x, flooded unassigned_leads_bucket,
-- and made can_view_lead — already measured at 3.6 s/query when `leads` had
-- 5,200 rows (see 20260605100000_short_circuit_leads_rls.sql) — run against
-- half a million rows.
--
-- Marketing contacts get their own narrow table with flat role-based RLS and
-- none of the admissions machinery. A contact is promoted into a real lead
-- only when it ENGAGES (WhatsApp reply, inbound call, website event) or when
-- staff hand-promote it. See the next migration for the promotion RPCs.
--
-- Idempotent: safe to re-run.

-- ── 1. The table ───────────────────────────────────────────────────────
-- Deliberately ~15 columns, not the 95 on `leads`. No stage, no counsellor,
-- no AI-call columns, no admissions columns, no attribution columns: a
-- contact that needs any of those is a lead, not a contact.
--
-- marketing_contacts.id IS the old leads.id for migrated rows, and a promoted
-- contact is re-inserted into `leads` under that same uuid. That keeps the
-- cutover a plain `UPDATE contact_id = lead_id` (no mapping table) and makes
-- promotion exactly reversible.
CREATE TABLE IF NOT EXISTS public.marketing_contacts (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone             text NOT NULL,
  name              text,
  email             text,
  city              text,
  area              text,
  state             text,
  source            text NOT NULL DEFAULT 'import',
  -- ponytail: one jsonb bag instead of 60 speculative columns. Promote to a
  -- real column only when something actually filters on it.
  meta              jsonb NOT NULL DEFAULT '{}'::jsonb,
  opted_out         boolean NOT NULL DEFAULT false,
  opted_out_at      timestamptz,
  -- Non-null once this contact became a lead. Campaign send renders params
  -- from the lead in that case, so we never message the same person twice.
  promoted_lead_id  uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  promoted_at       timestamptz,
  promotion_reason  text,
  last_contacted_at timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- One row per real phone number. Keyed on the normalized form so +91/0/bare
-- variants collapse, matching how every lookup in the codebase resolves.
CREATE UNIQUE INDEX IF NOT EXISTS marketing_contacts_phone_key
  ON public.marketing_contacts (public.normalize_lead_phone(phone));

CREATE INDEX IF NOT EXISTS marketing_contacts_promoted
  ON public.marketing_contacts (promoted_lead_id)
  WHERE promoted_lead_id IS NOT NULL;

-- Covers the campaign-send hot path: unpromoted, not opted out.
CREATE INDEX IF NOT EXISTS marketing_contacts_sendable
  ON public.marketing_contacts (id)
  WHERE opted_out = false AND promoted_lead_id IS NULL;

CREATE INDEX IF NOT EXISTS marketing_contacts_created
  ON public.marketing_contacts (created_at DESC);

DROP TRIGGER IF EXISTS trg_marketing_contacts_updated_at ON public.marketing_contacts;
CREATE TRIGGER trg_marketing_contacts_updated_at
  BEFORE UPDATE ON public.marketing_contacts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── 2. RLS ─────────────────────────────────────────────────────────────
-- Deliberately NOT can_view_lead. Marketing contacts have no counsellor
-- ownership and no admissions data, so there is nothing to scope per-row —
-- and that per-row function is precisely the cost this whole change removes.
-- Flat role check, no correlated subquery.
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

-- ── 3. Membership + campaign recipients become polymorphic ─────────────
-- These three NOT NULL FKs are what FORCED every imported contact into
-- `leads` in the first place. Each row now points at exactly one of a lead
-- or a contact, so the existing campaign machinery (dispatcher lease,
-- concurrency pool, retry/backoff, delivered/read/failed funnel) is reused
-- unchanged rather than forked.
ALTER TABLE public.lead_list_members
  ADD COLUMN IF NOT EXISTS contact_id uuid REFERENCES public.marketing_contacts(id) ON DELETE CASCADE;
ALTER TABLE public.whatsapp_campaign_recipients
  ADD COLUMN IF NOT EXISTS contact_id uuid REFERENCES public.marketing_contacts(id) ON DELETE CASCADE;
ALTER TABLE public.email_campaign_recipients
  ADD COLUMN IF NOT EXISTS contact_id uuid REFERENCES public.marketing_contacts(id) ON DELETE CASCADE;

-- lead_list_members' PK was (list_id, lead_id); a nullable lead_id can't carry
-- a PK, so the PK has to be swapped for a surrogate BEFORE the NOT NULL drop
-- (Postgres: "column lead_id is in a primary key"). Two partial uniques
-- preserve the same "one row per member per list" guarantee for both kinds.
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

-- Exactly one target. Added NOT VALID then validated so the statement does not
-- take a full-table ACCESS EXCLUSIVE rewrite lock on 662k membership rows.
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

-- ── 4. Statement-level member_count trigger ────────────────────────────
-- Was a per-ROW AFTER trigger that recounted the entire list. A 70k-member
-- import fired 70k full count(*)s against a growing table — the single
-- biggest reason import_leads_bulk was the #1 entry in pg_stat_statements
-- (16,723 s over 1,801 calls, 9.3 s mean). One recount per statement instead.
CREATE OR REPLACE FUNCTION public.lead_lists_refresh_member_count()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  WITH touched AS (
    SELECT list_id FROM new_rows
    UNION
    SELECT list_id FROM old_rows
  )
  UPDATE public.lead_lists l
     SET member_count = (SELECT count(*) FROM public.lead_list_members m WHERE m.list_id = l.id),
         updated_at   = now()
   WHERE l.id IN (SELECT list_id FROM touched);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_lead_list_members_count ON public.lead_list_members;
DROP TRIGGER IF EXISTS trg_lead_list_members_count_ins ON public.lead_list_members;
DROP TRIGGER IF EXISTS trg_lead_list_members_count_del ON public.lead_list_members;

-- Transition tables can't be shared across INSERT and DELETE in one trigger,
-- so it's two triggers over one function; the missing relation is aliased to
-- an empty set by the guards below.
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

CREATE TRIGGER trg_lead_list_members_count_ins
  AFTER INSERT ON public.lead_list_members
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.lead_lists_refresh_member_count_ins();

CREATE TRIGGER trg_lead_list_members_count_del
  AFTER DELETE ON public.lead_list_members
  REFERENCING OLD TABLE AS old_rows
  FOR EACH STATEMENT EXECUTE FUNCTION public.lead_lists_refresh_member_count_del();

-- The two-relation variant above is unreachable now; drop it so it can't rot.
DROP FUNCTION IF EXISTS public.lead_lists_refresh_member_count();
