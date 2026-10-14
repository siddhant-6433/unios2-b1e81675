-- keep-migration-version: restored production migration 20261012034304; preserve its applied version.
-- Keka imports retain their source and outcomes, with row-level atomicity.
ALTER TABLE public.employee_profiles ADD COLUMN IF NOT EXISTS keka_employee_id text,
 ADD COLUMN IF NOT EXISTS manager_employee_profile_id uuid REFERENCES employee_profiles(id);
CREATE UNIQUE INDEX IF NOT EXISTS employee_profiles_keka_id_uniq ON employee_profiles(keka_employee_id) WHERE keka_employee_id IS NOT NULL;
ALTER TABLE public.employee_documents ADD COLUMN IF NOT EXISTS checksum_sha256 text,ADD COLUMN IF NOT EXISTS source_reference text;
CREATE TABLE IF NOT EXISTS public.hr_migration_batches(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text NOT NULL,source_system text NOT NULL DEFAULT 'keka',
 mapping jsonb NOT NULL DEFAULT '{}',status text NOT NULL DEFAULT 'draft',created_by uuid REFERENCES auth.users(id) DEFAULT auth.uid(),
 created_at timestamptz NOT NULL DEFAULT now(),completed_at timestamptz);
CREATE TABLE IF NOT EXISTS public.hr_migration_rows(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),batch_id uuid NOT NULL REFERENCES hr_migration_batches(id) ON DELETE CASCADE,
 source_employee_id text NOT NULL,record_type text NOT NULL,source_record_id text NOT NULL,payload jsonb NOT NULL,
 candidate_ids uuid[] NOT NULL DEFAULT '{}',employee_profile_id uuid REFERENCES employee_profiles(id),
 status text NOT NULL DEFAULT 'ready' CHECK(status IN ('ready','ambiguous','imported','failed','skipped')),
 outcome text,error text,imported_at timestamptz,UNIQUE(batch_id,record_type,source_record_id));
CREATE TABLE IF NOT EXISTS public.hr_employee_history(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),employee_profile_id uuid NOT NULL REFERENCES employee_profiles(id),
 batch_id uuid REFERENCES hr_migration_batches(id),source_system text NOT NULL DEFAULT 'keka',
 record_type text NOT NULL,source_record_id text NOT NULL,source_employee_id text NOT NULL,
 payload jsonb NOT NULL,imported_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(source_system,record_type,source_record_id));
INSERT INTO permissions(module,action,description) VALUES('hr','migrate','Import and inspect confidential employee history') ON CONFLICT(module,action) DO NOTHING;
INSERT INTO role_permissions(role,permission_id) SELECT 'super_admin'::app_role,id FROM permissions WHERE module='hr' AND action='migrate' ON CONFLICT DO NOTHING;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['hr_migration_batches','hr_migration_rows','hr_employee_history'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('DROP POLICY IF EXISTS hr_migration_read ON public.%I',t);
  EXECUTE format('CREATE POLICY hr_migration_read ON public.%I FOR SELECT TO authenticated USING(public.has_permission(auth.uid(),''hr:migrate''))',t);
  EXECUTE format('GRANT SELECT ON public.%I TO authenticated',t);
  EXECUTE format('GRANT ALL ON public.%I TO service_role',t);
 END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.hr_stage_migration(_batch_id uuid,_name text,_mapping jsonb,_rows jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE b uuid:=_batch_id; item jsonb; candidates uuid[]; sid text;
BEGIN
 IF NOT has_permission(auth.uid(),'hr:migrate') OR NOT has_permission(auth.uid(),'hr:employees_edit') THEN RAISE EXCEPTION 'Forbidden'; END IF;
 IF jsonb_typeof(_rows)<>'array' OR jsonb_array_length(_rows)>500 THEN RAISE EXCEPTION 'Stage up to 500 rows at a time'; END IF;
 IF b IS NULL THEN INSERT INTO hr_migration_batches(name,mapping) VALUES(_name,_mapping) RETURNING id INTO b;
 ELSE PERFORM 1 FROM hr_migration_batches WHERE id=b FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'Batch missing'; END IF; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(_rows) LOOP
  sid:=NULLIF(btrim(item->>'source_employee_id'),'');
  IF sid IS NULL OR COALESCE(item->>'source_record_id','')='' OR COALESCE(item->>'record_type','')='' THEN RAISE EXCEPTION 'Source employee, record ID and type required'; END IF;
  SELECT array_agg(id) INTO candidates FROM employee_profiles WHERE keka_employee_id=sid;
  IF candidates IS NULL AND item->>'record_type'='profile' THEN
   SELECT array_agg(id) INTO candidates FROM employee_profiles WHERE
    (NULLIF(item->'profile'->>'employee_number','') IS NOT NULL AND employee_number=item->'profile'->>'employee_number')
    OR (NULLIF(item->'profile'->>'work_email','') IS NOT NULL AND lower(work_email)=lower(item->'profile'->>'work_email'));
  END IF;
  INSERT INTO hr_migration_rows(batch_id,source_employee_id,record_type,source_record_id,payload,candidate_ids,employee_profile_id,status)
   VALUES(b,sid,item->>'record_type',item->>'source_record_id',item,COALESCE(candidates,'{}'),
    CASE WHEN cardinality(candidates)=1 THEN candidates[1] END,CASE WHEN cardinality(candidates)>1 THEN 'ambiguous' ELSE 'ready' END)
   ON CONFLICT(batch_id,record_type,source_record_id) DO NOTHING;
 END LOOP;
 RETURN b;
END $$;
CREATE OR REPLACE FUNCTION public.hr_resolve_migration_row(_row_id uuid,_employee_id uuid,_skip boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
BEGIN
 IF NOT has_permission(auth.uid(),'hr:migrate') THEN RAISE EXCEPTION 'Forbidden'; END IF;
 IF NOT _skip AND _employee_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM employee_profiles WHERE id=_employee_id) THEN RAISE EXCEPTION 'Employee missing'; END IF;
 UPDATE hr_migration_rows SET employee_profile_id=_employee_id,status=CASE WHEN _skip THEN 'skipped' ELSE 'ready' END,error=NULL
 WHERE id=_row_id AND status<>'imported';
END $$;

CREATE OR REPLACE FUNCTION public.hr_import_profile(_profile jsonb,_bank jsonb DEFAULT '{}')
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE cols text; vals text; eid uuid:=gen_random_uuid(); clean jsonb; k text;
BEGIN
 IF NOT has_permission(auth.uid(),'hr:employees_edit') THEN RAISE EXCEPTION 'Forbidden'; END IF;
 clean:=_profile-'id'-'user_id'-'verified_by'-'verified_at'-'workspace_user_id'-'workspace_status'-'workspace_error';
 clean:=clean||jsonb_build_object('id',eid,'user_id',NULL,'verification_status','pending');
 IF COALESCE(clean->>'display_name','')='' THEN RAISE EXCEPTION 'Employee name required'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(clean) x(key) WHERE NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name='employee_profiles' AND column_name=x.key)) THEN RAISE EXCEPTION 'Unknown profile field'; END IF;
 SELECT string_agg(format('%I',key),','),string_agg(format('r.%I',key),',') INTO cols,vals FROM jsonb_object_keys(clean) AS x(key);
 EXECUTE format('INSERT INTO public.employee_profiles(%s) SELECT %s FROM jsonb_populate_record(NULL::public.employee_profiles,$1) r RETURNING id',cols,vals) INTO eid USING clean;
 IF _bank<>'{}'::jsonb THEN
  IF NOT has_permission(auth.uid(),'hr:bank_edit') THEN RAISE EXCEPTION 'Bank permission required'; END IF;
  INSERT INTO employee_bank_details(employee_profile_id,account_holder_name,account_number,ifsc,bank_name,branch)
  VALUES(eid,_bank->>'account_holder_name',_bank->>'account_number',_bank->>'ifsc',_bank->>'bank_name',_bank->>'branch');
 END IF;
 RETURN eid;
END $$;
REVOKE ALL ON FUNCTION hr_import_profile(jsonb,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION hr_import_profile(jsonb,jsonb) TO authenticated;

CREATE OR REPLACE FUNCTION public.hr_apply_migration(_batch_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r hr_migration_rows; e employee_profiles; eid uuid; sid text; manager_id uuid; outcomes jsonb;
BEGIN
 IF NOT has_permission(auth.uid(),'hr:migrate') OR NOT has_permission(auth.uid(),'hr:employees_edit') THEN RAISE EXCEPTION 'Forbidden'; END IF;
 PERFORM 1 FROM hr_migration_batches WHERE id=_batch_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Batch missing'; END IF;
 UPDATE hr_migration_batches SET status='processing' WHERE id=_batch_id;
 FOR r IN SELECT * FROM hr_migration_rows WHERE batch_id=_batch_id AND status IN ('ready','failed')
 ORDER BY CASE WHEN record_type='profile' THEN 0 WHEN record_type='manager' THEN 2 ELSE 1 END,id FOR UPDATE LOOP
  BEGIN
   IF COALESCE(r.payload->>'validation_error','')<>'' THEN RAISE EXCEPTION '%',r.payload->>'validation_error'; END IF;
   IF r.record_type='document' THEN RAISE EXCEPTION 'Upload the document archive to complete this row'; END IF;
   eid:=r.employee_profile_id;
   IF eid IS NULL THEN SELECT id INTO eid FROM employee_profiles WHERE keka_employee_id=r.source_employee_id; END IF;
   IF r.record_type='profile' THEN
    IF eid IS NULL THEN
     eid:=public.hr_import_profile(r.payload->'profile'||jsonb_build_object('keka_employee_id',r.source_employee_id),COALESCE(r.payload->'bank','{}'));
    ELSE
     SELECT * INTO e FROM employee_profiles WHERE id=eid FOR UPDATE;
     IF e.keka_employee_id IS NOT NULL AND e.keka_employee_id<>r.source_employee_id THEN RAISE EXCEPTION 'Employee has a different Keka identity'; END IF;
     UPDATE employee_profiles SET keka_employee_id=r.source_employee_id WHERE id=eid;
     -- Existing verified data is never overwritten by an export. Source remains available below.
    END IF;
   ELSIF eid IS NULL THEN RAISE EXCEPTION 'Import or resolve the employee profile first';
   END IF;
   IF r.record_type='salary' THEN
    PERFORM public.replace_employee_salary(eid,(r.payload->>'monthly_gross')::numeric,NULLIF(r.payload->>'annual_ctc','')::numeric,(r.payload->>'effective_from')::date,'Keka batch '||_batch_id);
   ELSIF r.record_type='leave_balance' THEN
    IF NOT has_permission(auth.uid(),'hr:leave_approve') THEN RAISE EXCEPTION 'Leave permission required'; END IF;
    INSERT INTO employee_leave_entitlements(employee_profile_id,leave_type_id,leave_year,entitled_days,used_days,carried_forward,opening_used_days,opening_entitlement_adjustment,opening_recorded_at)
    VALUES(eid,(r.payload->>'leave_type_id')::uuid,(r.payload->>'leave_year')::integer,(r.payload->>'entitled_days')::numeric,COALESCE((r.payload->>'used_days')::numeric,0),COALESCE((r.payload->>'carried_forward')::numeric,0),COALESCE((r.payload->>'used_days')::numeric,0),
     (r.payload->>'entitled_days')::numeric-(SELECT public.leave_entitlement_days(t.annual_days,t.accrual,(r.payload->>'leave_year')::integer,p.year_start_month,current_date) FROM leave_types t JOIN leave_plans p ON p.id=t.leave_plan_id WHERE t.id=(r.payload->>'leave_type_id')::uuid),now())
    ON CONFLICT(employee_profile_id,leave_type_id,leave_year) DO NOTHING;
   ELSIF r.record_type='manager' THEN
    SELECT id INTO manager_id FROM employee_profiles WHERE keka_employee_id=r.payload->>'manager_source_id';
    IF manager_id IS NULL OR manager_id=eid THEN RAISE EXCEPTION 'Resolve reporting manager first'; END IF;
    IF EXISTS(WITH RECURSIVE chain AS(SELECT manager_id AS id UNION SELECT e.manager_employee_profile_id FROM employee_profiles e JOIN chain c ON c.id=e.id WHERE e.manager_employee_profile_id IS NOT NULL) SELECT 1 FROM chain WHERE id=eid) THEN RAISE EXCEPTION 'Reporting cycle'; END IF;
    UPDATE employee_profiles SET manager_employee_profile_id=manager_id,reports_to=(SELECT user_id FROM employee_profiles WHERE id=manager_id) WHERE id=eid;
   END IF;
   INSERT INTO hr_employee_history(employee_profile_id,batch_id,record_type,source_record_id,source_employee_id,payload)
    VALUES(eid,_batch_id,r.record_type,r.source_record_id,r.source_employee_id,r.payload)
    ON CONFLICT(source_system,record_type,source_record_id) DO NOTHING;
   UPDATE hr_migration_rows SET status='imported',employee_profile_id=eid,imported_at=now(),error=NULL,
    outcome=CASE WHEN r.record_type='profile' AND r.employee_profile_id IS NOT NULL THEN 'Existing employee linked; original source preserved without overwriting approved data' ELSE 'Imported' END WHERE id=r.id;
  EXCEPTION WHEN OTHERS THEN
   UPDATE hr_migration_rows SET status='failed',error=SQLERRM WHERE id=r.id;
  END;
 END LOOP;
 SELECT jsonb_object_agg(status,n) INTO outcomes FROM(SELECT status,count(*) n FROM hr_migration_rows WHERE batch_id=_batch_id GROUP BY status) q;
 UPDATE hr_migration_batches SET status=CASE WHEN EXISTS(SELECT 1 FROM hr_migration_rows WHERE batch_id=_batch_id AND status IN ('failed','ambiguous','ready')) THEN 'needs_attention' ELSE 'completed' END,completed_at=now() WHERE id=_batch_id;
 RETURN COALESCE(outcomes,'{}');
END $$;
REVOKE ALL ON FUNCTION hr_stage_migration(uuid,text,jsonb,jsonb),hr_resolve_migration_row(uuid,uuid,boolean),hr_apply_migration(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION hr_stage_migration(uuid,text,jsonb,jsonb),hr_resolve_migration_row(uuid,uuid,boolean),hr_apply_migration(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.hr_sync_imported_manager_login()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ BEGIN
 IF NEW.user_id IS DISTINCT FROM OLD.user_id THEN UPDATE employee_profiles SET reports_to=NEW.user_id WHERE manager_employee_profile_id=NEW.id; END IF;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS hr_sync_imported_manager_login ON public.employee_profiles;
CREATE TRIGGER hr_sync_imported_manager_login AFTER UPDATE OF user_id ON employee_profiles FOR EACH ROW EXECUTE FUNCTION hr_sync_imported_manager_login();

CREATE OR REPLACE FUNCTION public.hr_document_import_failure(_row_id uuid,_error text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ BEGIN
 IF NOT has_permission(auth.uid(),'hr:migrate') THEN RAISE EXCEPTION 'Forbidden'; END IF;
 UPDATE hr_migration_rows SET status='failed',error=left(_error,2000) WHERE id=_row_id AND record_type='document' AND status<>'imported';
END $$;
REVOKE ALL ON FUNCTION hr_document_import_failure(uuid,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION hr_document_import_failure(uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.hr_reconcile_migration(_batch_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$ BEGIN
 IF NOT has_permission(auth.uid(),'hr:migrate') THEN RAISE EXCEPTION 'Forbidden'; END IF;
 UPDATE hr_migration_batches SET status=CASE WHEN EXISTS(SELECT 1 FROM hr_migration_rows WHERE batch_id=_batch_id AND status NOT IN ('imported','skipped')) THEN 'needs_review' ELSE 'completed' END,
 completed_at=CASE WHEN EXISTS(SELECT 1 FROM hr_migration_rows WHERE batch_id=_batch_id AND status NOT IN ('imported','skipped')) THEN NULL ELSE now() END WHERE id=_batch_id;
END $$;
REVOKE ALL ON FUNCTION hr_reconcile_migration(uuid) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION hr_reconcile_migration(uuid) TO authenticated;
