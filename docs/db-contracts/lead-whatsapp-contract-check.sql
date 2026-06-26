-- Non-mutating DB contract check for the shared lead transition and WhatsApp
-- conversation action contract.
--
-- Run this against staging/prod before marking the lead/WhatsApp contract PR
-- ready. It raises an exception if the deployed database cannot support the
-- Edge Function writes used by the shared contract helpers.

do $$
declare
  missing text[];
begin
  select array_agg(name)
    into missing
  from (
    values
      ('public.leads'),
      ('public.lead_activities'),
      ('public.whatsapp_messages'),
      ('public.whatsapp_outbound_context'),
      ('public.whatsapp_automation_events'),
      ('public.whatsapp_conversation_state'),
      ('public.whatsapp_ai_mode')
  ) as required(name)
  where to_regclass(required.name) is null;

  if coalesce(array_length(missing, 1), 0) > 0 then
    raise exception 'Missing required tables: %', array_to_string(missing, ', ');
  end if;

  select array_agg(table_name || '.' || column_name)
    into missing
  from (
    values
      ('leads', 'id'),
      ('leads', 'stage'),
      ('lead_activities', 'lead_id'),
      ('lead_activities', 'user_id'),
      ('lead_activities', 'type'),
      ('lead_activities', 'description'),
      ('lead_activities', 'old_stage'),
      ('lead_activities', 'new_stage'),
      ('whatsapp_messages', 'id'),
      ('whatsapp_messages', 'lead_id'),
      ('whatsapp_messages', 'wa_message_id'),
      ('whatsapp_messages', 'direction'),
      ('whatsapp_messages', 'phone'),
      ('whatsapp_messages', 'message_type'),
      ('whatsapp_messages', 'content'),
      ('whatsapp_messages', 'template_key'),
      ('whatsapp_messages', 'status'),
      ('whatsapp_messages', 'is_read'),
      ('whatsapp_messages', 'provider'),
      ('whatsapp_messages', 'business_phone_number_id'),
      ('whatsapp_messages', 'business_phone_number'),
      ('whatsapp_messages', 'status_error'),
      ('whatsapp_messages', 'sender_user_id'),
      ('whatsapp_outbound_context', 'message_id'),
      ('whatsapp_outbound_context', 'provider_message_id'),
      ('whatsapp_outbound_context', 'phone'),
      ('whatsapp_outbound_context', 'business_number'),
      ('whatsapp_outbound_context', 'provider'),
      ('whatsapp_outbound_context', 'lead_id'),
      ('whatsapp_outbound_context', 'campaign_id'),
      ('whatsapp_outbound_context', 'campaign_recipient_id'),
      ('whatsapp_outbound_context', 'template_key'),
      ('whatsapp_outbound_context', 'outbound_kind'),
      ('whatsapp_outbound_context', 'expected_reply_type'),
      ('whatsapp_outbound_context', 'response_policy'),
      ('whatsapp_outbound_context', 'metadata'),
      ('whatsapp_outbound_context', 'expires_at'),
      ('whatsapp_automation_events', 'phone'),
      ('whatsapp_automation_events', 'business_number'),
      ('whatsapp_automation_events', 'provider'),
      ('whatsapp_automation_events', 'lead_id'),
      ('whatsapp_automation_events', 'message_id'),
      ('whatsapp_automation_events', 'event_type'),
      ('whatsapp_automation_events', 'decision'),
      ('whatsapp_automation_events', 'reason'),
      ('whatsapp_automation_events', 'confidence'),
      ('whatsapp_automation_events', 'metadata'),
      ('whatsapp_conversation_state', 'phone'),
      ('whatsapp_conversation_state', 'business_number'),
      ('whatsapp_conversation_state', 'provider'),
      ('whatsapp_conversation_state', 'lead_id'),
      ('whatsapp_conversation_state', 'mode'),
      ('whatsapp_conversation_state', 'state'),
      ('whatsapp_conversation_state', 'owner_user_id'),
      ('whatsapp_conversation_state', 'escalation_role'),
      ('whatsapp_conversation_state', 'handoff_reason'),
      ('whatsapp_conversation_state', 'priority'),
      ('whatsapp_conversation_state', 'sla_due_at'),
      ('whatsapp_conversation_state', 'last_intent'),
      ('whatsapp_conversation_state', 'last_confidence'),
      ('whatsapp_conversation_state', 'last_bot_action'),
      ('whatsapp_conversation_state', 'updated_by'),
      ('whatsapp_ai_mode', 'phone'),
      ('whatsapp_ai_mode', 'business_number'),
      ('whatsapp_ai_mode', 'mode'),
      ('whatsapp_ai_mode', 'updated_at'),
      ('whatsapp_ai_mode', 'updated_by')
  ) as required(table_name, column_name)
  where not exists (
    select 1
    from information_schema.columns c
    where c.table_schema = 'public'
      and c.table_name = required.table_name
      and c.column_name = required.column_name
  );

  if coalesce(array_length(missing, 1), 0) > 0 then
    raise exception 'Missing required columns: %', array_to_string(missing, ', ');
  end if;

  select array_agg(value)
    into missing
  from (
    values
      ('new_lead'),
      ('dnc'),
      ('not_interested'),
      ('ineligible')
  ) as required(value)
  where not exists (
    select 1
    from pg_type t
    join pg_enum e on e.enumtypid = t.oid
    join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public'
      and t.typname = 'lead_stage'
      and e.enumlabel = required.value
  );

  if coalesce(array_length(missing, 1), 0) > 0 then
    raise exception 'Missing required lead_stage enum values: %', array_to_string(missing, ', ');
  end if;

  select array_agg(value)
    into missing
  from (
    values
      ('whatsapp'),
      ('stage_change')
  ) as required(value)
  where not exists (
    select 1
    from pg_constraint c
    where c.conrelid = 'public.lead_activities'::regclass
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) like '%' || required.value || '%'
  );

  if coalesce(array_length(missing, 1), 0) > 0 then
    raise exception 'lead_activities.type check is missing values: %', array_to_string(missing, ', ');
  end if;

  select array_agg(value)
    into missing
  from (
    values
      ('manual_reply'),
      ('ai_reply'),
      ('template'),
      ('bulk_campaign'),
      ('system_notification'),
      ('general'),
      ('do_not_reply'),
      ('engine'),
      ('human'),
      ('suppress')
  ) as required(value)
  where not exists (
    select 1
    from pg_constraint c
    where c.conrelid = 'public.whatsapp_outbound_context'::regclass
      and c.contype = 'c'
      and pg_get_constraintdef(c.oid) like '%' || required.value || '%'
  );

  if coalesce(array_length(missing, 1), 0) > 0 then
    raise exception 'whatsapp_outbound_context checks are missing values: %', array_to_string(missing, ', ');
  end if;

  if not exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'mark_whatsapp_conversation_read'
  ) then
    raise exception 'Missing required RPC: public.mark_whatsapp_conversation_read';
  end if;
end $$;
