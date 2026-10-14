-- keep-migration-version: restored production migration 20261013121408; preserve its applied version.
-- hr migration chunked apply
-- Apply migration batches in bounded transactions so PostgREST statement
-- timeouts do not roll back large imports. Failed rows are retried explicitly.
CREATE OR REPLACE FUNCTION public.hr_retry_failed_migration_rows(_batch_id uuid)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE n integer;
BEGIN
 IF NOT has_permission(auth.uid(),'hr:migrate') OR NOT has_permission(auth.uid(),'hr:employees_edit') THEN RAISE EXCEPTION 'Forbidden'; END IF;
 PERFORM 1 FROM hr_migration_batches WHERE id=_batch_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Batch missing'; END IF;
 UPDATE hr_migration_rows SET status='ready',error=NULL
 WHERE batch_id=_batch_id AND status='failed';
 GET DIAGNOSTICS n=ROW_COUNT;
 RETURN n;
END $$;

CREATE OR REPLACE FUNCTION public.hr_apply_migration_chunk(_batch_id uuid,_limit integer DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE r hr_migration_rows; e employee_profiles; eid uuid; manager_id uuid;
        processed integer:=0; outcomes jsonb;
BEGIN
 IF NOT has_permission(auth.uid(),'hr:migrate') OR NOT has_permission(auth.uid(),'hr:employees_edit') THEN RAISE EXCEPTION 'Forbidden'; END IF;
 PERFORM 1 FROM hr_migration_batches WHERE id=_batch_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Batch missing'; END IF;
 UPDATE hr_migration_batches SET status='processing',completed_at=NULL WHERE id=_batch_id;
 FOR r IN SELECT * FROM hr_migration_rows WHERE batch_id=_batch_id AND status='ready'
 ORDER BY CASE WHEN record_type='profile' THEN 0 WHEN record_type='manager' THEN 2 ELSE 1 END,id
 LIMIT least(greatest(COALESCE(_limit,50),1),100) FOR UPDATE LOOP
  processed:=processed+1;
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
    IF EXISTS(WITH RECURSIVE chain AS(SELECT manager_id AS id UNION SELECT ep.manager_employee_profile_id FROM employee_profiles ep JOIN chain c ON c.id=ep.id WHERE ep.manager_employee_profile_id IS NOT NULL) SELECT 1 FROM chain WHERE id=eid) THEN RAISE EXCEPTION 'Reporting cycle'; END IF;
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
 UPDATE hr_migration_batches SET status=CASE
   WHEN EXISTS(SELECT 1 FROM hr_migration_rows WHERE batch_id=_batch_id AND status IN ('ready','failed','ambiguous')) THEN 'needs_attention'
   ELSE 'completed' END,
   completed_at=CASE WHEN EXISTS(SELECT 1 FROM hr_migration_rows WHERE batch_id=_batch_id AND status IN ('ready','failed','ambiguous')) THEN NULL ELSE now() END
 WHERE id=_batch_id;
 RETURN COALESCE(outcomes,'{}')||jsonb_build_object('processed',processed);
END $$;
REVOKE ALL ON FUNCTION hr_retry_failed_migration_rows(uuid),hr_apply_migration_chunk(uuid,integer) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION hr_retry_failed_migration_rows(uuid),hr_apply_migration_chunk(uuid,integer) TO authenticated;
