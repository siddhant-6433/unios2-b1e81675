-- keep-migration-version: restored production migration 20261012063321; preserve its applied version.
-- SECURITY DEFINER self-service RPCs bypass RLS. Preserve their signatures,
-- grants and business logic, but reject disabled authenticated identities first.
DO $$
DECLARE f record; definition text; body text; guard text;
BEGIN
 guard:=E'-- HR_ACCESS_GUARD\n IF auth.role()=''authenticated'' AND NOT public.is_account_active(auth.uid()) THEN RAISE EXCEPTION ''Account access disabled''; END IF;\n';
 FOR f IN SELECT p.oid,p.prosrc,p.proretset,l.lanname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace JOIN pg_language l ON l.oid=p.prolang
 WHERE n.nspname='public' AND p.prosecdef AND p.proname=ANY(ARRAY[
 'employee_directory_card','employee_pending_documents','create_helpdesk_ticket','my_payslips','my_comp_off',
 'request_leave_encashment','my_leave_balances','my_employee_fields','my_reporting_manager','submit_expense_claim','fn_expense_review']) LOOP
  IF position('HR_ACCESS_GUARD' IN f.prosrc)>0 THEN CONTINUE; END IF;
  definition:=pg_get_functiondef(f.oid);
  IF f.lanname='plpgsql' THEN
   body:=regexp_replace(f.prosrc,'\mBEGIN\M','BEGIN'||E'\n'||guard,'i');
  ELSIF f.lanname='sql' AND f.proretset THEN
   definition:=replace(definition,'LANGUAGE sql','LANGUAGE plpgsql');
   body:='BEGIN'||E'\n'||guard||' RETURN QUERY '||regexp_replace(f.prosrc,';[[:space:]]*$','')||'; END';
  ELSE RAISE EXCEPTION 'Unexpected self-service RPC language or return shape: %',f.oid::regprocedure;
  END IF;
  IF body=f.prosrc THEN RAISE EXCEPTION 'Could not guard self-service RPC: %',f.oid::regprocedure; END IF;
  EXECUTE replace(definition,f.prosrc,body);
 END LOOP;
END $$;
