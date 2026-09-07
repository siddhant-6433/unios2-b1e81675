-- Assign Round Robin failed with: column reference "assigned_count" is ambiguous.
--
-- assign_lead_list_round_robin RETURNS TABLE(..., assigned_count, failed_count),
-- so those names exist as OUT variables. The later
--   UPDATE lead_list_assignment_batches SET assigned_count = ..., failed_count = ...
-- then collides with the table columns — the same PL/pgSQL class as
-- 20260806140931 (close_day / campus_id).
--
-- Production also grew a 7-arg overload (_limit integer DEFAULT 5000) that is
-- not in this tree. Recreating from identity arguments strips those defaults
-- (42P13). Patch each overload via pg_get_functiondef, then drop the 6-arg
-- form when the 7-arg one is present so PostgREST named calls resolve uniquely.

DO $do$
DECLARE
  r record;
  def text;
  newdef text;
BEGIN
  FOR r IN
    SELECT p.oid, pg_get_function_identity_arguments(p.oid) AS args
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'assign_lead_list_round_robin'
  LOOP
    SELECT pg_get_functiondef(r.oid) INTO def;
    IF def IS NULL THEN
      CONTINUE;
    END IF;
    IF position('#variable_conflict use_column' in def) = 0 THEN
      newdef := regexp_replace(
        def,
        '(AS \$[^$]*\$[[:space:]]*)',
        E'\\1#variable_conflict use_column\n',
        ''
      );
      IF newdef = def THEN
        RAISE EXCEPTION 'Could not inject #variable_conflict into assign_lead_list_round_robin(%)', r.args;
      END IF;
      EXECUTE newdef;
    END IF;

    EXECUTE format(
      'REVOKE ALL ON FUNCTION public.assign_lead_list_round_robin(%s) FROM PUBLIC, anon',
      r.args
    );
    EXECUTE format(
      'GRANT EXECUTE ON FUNCTION public.assign_lead_list_round_robin(%s) TO authenticated',
      r.args
    );
  END LOOP;
END
$do$;

DO $do$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'assign_lead_list_round_robin'
      AND pg_get_function_identity_arguments(p.oid) LIKE '%_limit%'
  ) THEN
    DROP FUNCTION IF EXISTS public.assign_lead_list_round_robin(uuid, uuid[], boolean, text, date, boolean);
  END IF;
END
$do$;
