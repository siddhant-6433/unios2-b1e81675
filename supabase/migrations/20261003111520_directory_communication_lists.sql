-- Directory audiences stay live; campaign recipients are immutable snapshots.
ALTER TABLE public.lead_lists ADD COLUMN audience_type text NOT NULL DEFAULT 'leads'
  CHECK (audience_type IN ('leads', 'consultants', 'academic_partners'));
ALTER TABLE public.lead_lists ADD CONSTRAINT directory_lists_marketing_only
  CHECK (audience_type = 'leads' OR (purpose = 'marketing' AND list_type = 'dynamic'));
CREATE UNIQUE INDEX directory_lists_one_active ON public.lead_lists(audience_type)
  WHERE audience_type <> 'leads' AND archived_at IS NULL;

CREATE FUNCTION public.can_access_directory_audience(_audience text, _user_id uuid DEFAULT auth.uid())
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
 SELECT COALESCE(CASE _audience
 WHEN 'consultants' THEN public.has_role(_user_id, 'super_admin')
   OR public.has_role(_user_id, 'campus_admin') OR public.has_role(_user_id, 'admission_head')
   OR ((public.has_role(_user_id, 'principal') OR public.has_role(_user_id, 'counsellor'))
       AND 'consultants:view' = ANY(public.get_user_permissions(_user_id)))
 WHEN 'academic_partners' THEN public.has_role(_user_id, 'super_admin')
   OR public.has_role(_user_id, 'campus_admin') OR public.has_role(_user_id, 'admission_head')
 ELSE false END, false);
$$;
CREATE POLICY directory_list_access ON public.lead_lists AS RESTRICTIVE FOR ALL TO authenticated
 USING (audience_type = 'leads' OR public.can_access_directory_audience(audience_type))
 WITH CHECK (audience_type = 'leads' OR public.can_access_directory_audience(audience_type));

CREATE FUNCTION public.ensure_directory_communication_list(_audience text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
 IF NOT public.can_access_directory_audience(_audience) OR NOT public.can_manage_lead_lists() THEN
   RAISE EXCEPTION 'Directory audience access denied' USING ERRCODE = '42501';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtext('directory-list:' || _audience));
 SELECT id INTO v_id FROM public.lead_lists WHERE audience_type = _audience AND archived_at IS NULL;
 IF v_id IS NULL THEN
   INSERT INTO public.lead_lists(name, audience_type, list_type, purpose, source, filter_definition, created_by)
   VALUES (CASE _audience WHEN 'consultants' THEN 'All Consultants' ELSE 'All Academic Partners' END,
     _audience, 'dynamic', 'marketing', 'filter', jsonb_build_object('directory', _audience),
     (SELECT id FROM public.profiles WHERE user_id = auth.uid() LIMIT 1)) RETURNING id INTO v_id;
 END IF;
 RETURN v_id;
END;
$$;

CREATE FUNCTION public.directory_list_members_page(_list_id uuid, _limit int DEFAULT 500, _offset int DEFAULT 0)
RETURNS TABLE(member_id uuid, kind text, target_id uuid, name text, phone text, email text, stage text, total_count bigint)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_audience text;
BEGIN
 SELECT audience_type INTO v_audience FROM public.lead_lists WHERE id = _list_id;
 IF NOT public.can_access_directory_audience(v_audience) THEN
   RAISE EXCEPTION 'Directory audience access denied' USING ERRCODE = '42501';
 END IF;
 IF v_audience = 'consultants' THEN
   RETURN QUERY SELECT c.id, 'consultant'::text, c.id, c.name, c.phone, c.email, c.stage::text, count(*) OVER ()
     FROM public.consultants c ORDER BY c.id LIMIT LEAST(GREATEST(_limit, 1), 500) OFFSET GREATEST(_offset, 0);
 ELSE
   RETURN QUERY SELECT c.id, 'academic_partner'::text, c.id, c.name, c.phone, c.email, c.status::text, count(*) OVER ()
     FROM public.academic_partners c ORDER BY c.id LIMIT LEAST(GREATEST(_limit, 1), 500) OFFSET GREATEST(_offset, 0);
 END IF;
END;
$$;

-- The existing cron continues to refresh only lead audiences.
ALTER FUNCTION public.resolve_dynamic_list_members(uuid) RENAME TO resolve_dynamic_lead_list_members;
CREATE FUNCTION public.resolve_dynamic_list_members(_list_id uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
 IF EXISTS (SELECT 1 FROM public.lead_lists WHERE id = _list_id AND audience_type <> 'leads') THEN
   RETURN jsonb_build_object('added', 0, 'removed', 0, 'skipped', true);
 END IF;
 RETURN public.resolve_dynamic_lead_list_members(_list_id);
END;
$$;

-- UUID identities intentionally survive directory deletion, preserving send history.
ALTER TABLE public.whatsapp_campaign_recipients
 ADD COLUMN consultant_id uuid, ADD COLUMN academic_partner_id uuid, ADD COLUMN recipient_name text, ADD COLUMN recipient_phone text, ADD COLUMN recipient_email text;
ALTER TABLE public.email_campaign_recipients
 ADD COLUMN consultant_id uuid, ADD COLUMN academic_partner_id uuid, ADD COLUMN recipient_name text, ADD COLUMN recipient_phone text, ADD COLUMN recipient_email text;
ALTER TABLE public.whatsapp_campaign_recipients DROP CONSTRAINT whatsapp_campaign_recipients_one_target;
ALTER TABLE public.whatsapp_campaign_recipients ADD CONSTRAINT whatsapp_campaign_recipients_one_target
 CHECK (num_nonnulls(lead_id, contact_id, consultant_id, academic_partner_id) = 1);
ALTER TABLE public.email_campaign_recipients DROP CONSTRAINT email_campaign_recipients_one_target;
ALTER TABLE public.email_campaign_recipients ADD CONSTRAINT email_campaign_recipients_one_target
 CHECK (num_nonnulls(lead_id, contact_id, consultant_id, academic_partner_id) = 1);
CREATE POLICY directory_recipient_access ON public.whatsapp_campaign_recipients AS RESTRICTIVE FOR ALL TO authenticated
 USING ((consultant_id IS NULL OR public.can_access_directory_audience('consultants')) AND
        (academic_partner_id IS NULL OR public.can_access_directory_audience('academic_partners')))
 WITH CHECK ((consultant_id IS NULL OR public.can_access_directory_audience('consultants')) AND
        (academic_partner_id IS NULL OR public.can_access_directory_audience('academic_partners')));
CREATE POLICY directory_recipient_access ON public.email_campaign_recipients AS RESTRICTIVE FOR ALL TO authenticated
 USING ((consultant_id IS NULL OR public.can_access_directory_audience('consultants')) AND
        (academic_partner_id IS NULL OR public.can_access_directory_audience('academic_partners')))
 WITH CHECK ((consultant_id IS NULL OR public.can_access_directory_audience('consultants')) AND
        (academic_partner_id IS NULL OR public.can_access_directory_audience('academic_partners')));
REVOKE ALL ON FUNCTION public.ensure_directory_communication_list(text), public.directory_list_members_page(uuid,int,int), public.can_access_directory_audience(text,uuid), public.resolve_dynamic_list_members(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_directory_communication_list(text), public.directory_list_members_page(uuid,int,int), public.can_access_directory_audience(text,uuid), public.resolve_dynamic_list_members(uuid) TO authenticated, service_role;
-- No caller may feed a directory definition into the original lead resolver.
REVOKE ALL ON FUNCTION public.resolve_dynamic_lead_list_members(uuid) FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.reject_directory_list_members() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
 IF EXISTS (SELECT 1 FROM public.lead_lists WHERE id = NEW.list_id AND audience_type <> 'leads') THEN
   RAISE EXCEPTION 'Directory lists resolve membership live';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER directory_lists_no_materialized_members BEFORE INSERT OR UPDATE OF list_id
 ON public.lead_list_members FOR EACH ROW EXECUTE FUNCTION public.reject_directory_list_members();
-- Directory lists may only be used by staff with access to that directory.
CREATE POLICY directory_campaign_list_access ON public.whatsapp_campaigns AS RESTRICTIVE FOR ALL TO authenticated
 USING (list_id IS NULL OR EXISTS (SELECT 1 FROM public.lead_lists l WHERE l.id = list_id))
 WITH CHECK (list_id IS NULL OR EXISTS (SELECT 1 FROM public.lead_lists l WHERE l.id = list_id));
CREATE POLICY directory_campaign_list_access ON public.email_campaigns AS RESTRICTIVE FOR ALL TO authenticated
 USING (list_id IS NULL OR EXISTS (SELECT 1 FROM public.lead_lists l WHERE l.id = list_id))
 WITH CHECK (list_id IS NULL OR EXISTS (SELECT 1 FROM public.lead_lists l WHERE l.id = list_id));
