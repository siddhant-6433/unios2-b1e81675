-- Rich conversation state for WhatsApp AI/human handoff. This sits beside
-- whatsapp_ai_mode for backwards compatibility, but becomes the canonical
-- source for mode, owner, escalation, SLA, and bot decision metadata.

create table if not exists public.whatsapp_conversation_state (
  phone text not null,
  business_number text not null,
  provider text not null check (provider in ('meta', 'plivo')),
  lead_id uuid references public.leads(id) on delete set null,
  mode text not null default 'ai' check (mode in ('ai', 'human', 'paused', 'closed')),
  state text not null default 'new_unqualified' check (state in (
    'new_unqualified',
    'awaiting_name',
    'awaiting_course',
    'qualified',
    'answered_by_ai',
    'needs_counsellor',
    'human_active',
    'followup_scheduled',
    'not_interested',
    'dnc',
    'job_handoff',
    'vendor_handoff',
    'knowledge_gap'
  )),
  owner_user_id uuid,
  escalation_role text,
  handoff_reason text,
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  sla_due_at timestamptz,
  last_intent text,
  last_confidence numeric,
  last_bot_action text,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  primary key (phone, business_number)
);

comment on table public.whatsapp_conversation_state is
  'Per WhatsApp conversation mode/state/ownership. business_number is Meta phone-number ID for Meta channels and digits-only sender number for Plivo.';

create index if not exists idx_wa_conversation_state_mode_state
  on public.whatsapp_conversation_state (mode, state);

create index if not exists idx_wa_conversation_state_owner
  on public.whatsapp_conversation_state (owner_user_id)
  where owner_user_id is not null;

create index if not exists idx_wa_conversation_state_sla
  on public.whatsapp_conversation_state (sla_due_at)
  where sla_due_at is not null;

create or replace function public.set_whatsapp_conversation_state_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_whatsapp_conversation_state_updated_at on public.whatsapp_conversation_state;
create trigger trg_whatsapp_conversation_state_updated_at
  before update on public.whatsapp_conversation_state
  for each row execute function public.set_whatsapp_conversation_state_updated_at();

alter table public.whatsapp_conversation_state enable row level security;

grant select, insert, update on public.whatsapp_conversation_state to authenticated;
grant select, insert, update on public.whatsapp_conversation_state to service_role;

drop policy if exists "wa_conversation_state_select" on public.whatsapp_conversation_state;
create policy "wa_conversation_state_select" on public.whatsapp_conversation_state
  for select to authenticated using (true);

drop policy if exists "wa_conversation_state_insert" on public.whatsapp_conversation_state;
create policy "wa_conversation_state_insert" on public.whatsapp_conversation_state
  for insert to authenticated with check (true);

drop policy if exists "wa_conversation_state_update" on public.whatsapp_conversation_state;
create policy "wa_conversation_state_update" on public.whatsapp_conversation_state
  for update to authenticated using (true) with check (true);

-- Seed state rows from existing messages so the inbox can display state
-- immediately after the migration. The latest message on each phone+channel
-- supplies lead/provider context; missing state defaults to ai/new_unqualified.
insert into public.whatsapp_conversation_state (
  phone,
  business_number,
  provider,
  lead_id,
  mode,
  state,
  owner_user_id,
  updated_at
)
select distinct on (wm.phone, case when wm.provider = 'plivo' then coalesce(wm.business_phone_number, wm.business_phone_number_id, '') else coalesce(wm.business_phone_number_id, wm.business_phone_number, '') end)
  wm.phone,
  case when wm.provider = 'plivo' then coalesce(wm.business_phone_number, wm.business_phone_number_id, '') else coalesce(wm.business_phone_number_id, wm.business_phone_number, '') end as business_number,
  wm.provider,
  wm.lead_id,
  coalesce(aim.mode, 'ai') as mode,
  case
    when l.stage = 'dnc' then 'dnc'
    when l.stage = 'not_interested' then 'not_interested'
    when coalesce(aim.mode, 'ai') = 'human' then 'human_active'
    when wm.direction = 'outbound' and wm.template_key = 'ai_auto_reply' then 'answered_by_ai'
    else 'new_unqualified'
  end as state,
  l.counsellor_id as owner_user_id,
  greatest(wm.created_at, coalesce(aim.updated_at, wm.created_at)) as updated_at
from public.whatsapp_messages wm
left join public.leads l on l.id = wm.lead_id
left join public.whatsapp_ai_mode aim
  on aim.phone = wm.phone
 and aim.business_number = case when wm.provider = 'plivo' then coalesce(wm.business_phone_number, wm.business_phone_number_id, '') else coalesce(wm.business_phone_number_id, wm.business_phone_number, '') end
where case when wm.provider = 'plivo' then coalesce(wm.business_phone_number, wm.business_phone_number_id, '') else coalesce(wm.business_phone_number_id, wm.business_phone_number, '') end <> ''
order by wm.phone,
  case when wm.provider = 'plivo' then coalesce(wm.business_phone_number, wm.business_phone_number_id, '') else coalesce(wm.business_phone_number_id, wm.business_phone_number, '') end,
  wm.created_at desc
on conflict (phone, business_number) do nothing;

drop view if exists public.whatsapp_conversations;
drop function if exists public.get_whatsapp_conversations();

create or replace function public.get_whatsapp_conversations()
returns table (
  phone text,
  lead_id uuid,
  lead_name text,
  lead_stage text,
  lead_person_role text,
  counsellor_id uuid,
  counsellor_name text,
  course_name text,
  last_message text,
  last_direction text,
  last_message_at timestamptz,
  assigned_to uuid,
  provider text,
  business_phone_number_id text,
  business_phone_number text,
  conversation_mode text,
  conversation_state text,
  owner_user_id uuid,
  escalation_role text,
  handoff_reason text,
  priority text,
  sla_due_at timestamptz,
  last_intent text,
  last_confidence numeric,
  last_bot_action text,
  unread_count integer,
  has_inbound boolean,
  lead_counsellor_ids uuid[]
)
language sql
stable
security definer
set search_path = public
as $$
  select distinct on (latest.phone, coalesce(latest.business_phone_number_id, ''))
    latest.phone,
    latest.lead_id,
    l.name as lead_name,
    l.stage::text as lead_stage,
    l.person_role as lead_person_role,
    l.counsellor_id,
    p.display_name as counsellor_name,
    c.name as course_name,
    latest.content as last_message,
    latest.direction as last_direction,
    latest.created_at as last_message_at,
    latest.assigned_to,
    latest.provider,
    latest.business_phone_number_id,
    latest.business_phone_number,
    coalesce(wcs.mode, 'ai') as conversation_mode,
    coalesce(wcs.state,
      case
        when l.stage = 'dnc' then 'dnc'
        when l.stage = 'not_interested' then 'not_interested'
        else 'new_unqualified'
      end
    ) as conversation_state,
    coalesce(wcs.owner_user_id, l.counsellor_id) as owner_user_id,
    wcs.escalation_role,
    wcs.handoff_reason,
    coalesce(wcs.priority, 'normal') as priority,
    wcs.sla_due_at,
    wcs.last_intent,
    wcs.last_confidence,
    wcs.last_bot_action,
    coalesce(unread.cnt, 0)::integer as unread_count,
    coalesce(inbound.cnt, 0)::integer > 0 as has_inbound,
    coalesce(cc.ids, array[]::uuid[]) as lead_counsellor_ids
  from public.whatsapp_messages latest
  left join public.leads l on l.id = latest.lead_id
  left join public.profiles p on p.id = l.counsellor_id
  left join public.courses c on c.id = l.course_id
  left join public.whatsapp_conversation_state wcs
    on wcs.phone = latest.phone
   and wcs.business_number = case
      when latest.provider = 'plivo' then coalesce(latest.business_phone_number, latest.business_phone_number_id, '')
      else coalesce(latest.business_phone_number_id, latest.business_phone_number, '')
    end
  left join lateral (
    select count(*) as cnt
    from public.whatsapp_messages wm2
    where wm2.phone = latest.phone
      and wm2.direction = 'inbound'
      and wm2.is_read = false
      and coalesce(wm2.business_phone_number_id,'') = coalesce(latest.business_phone_number_id,'')
  ) unread on true
  left join lateral (
    select count(*) as cnt
    from public.whatsapp_messages wm3
    where wm3.phone = latest.phone
      and wm3.direction = 'inbound'
      and coalesce(wm3.business_phone_number_id,'') = coalesce(latest.business_phone_number_id,'')
  ) inbound on true
  left join lateral (
    select array_agg(distinct l2.counsellor_id) as ids
    from public.whatsapp_messages wm4
    join public.leads l2 on l2.id = wm4.lead_id
    where wm4.phone = latest.phone
      and coalesce(wm4.business_phone_number_id,'') = coalesce(latest.business_phone_number_id,'')
      and l2.counsellor_id is not null
  ) cc on true
  order by latest.phone, coalesce(latest.business_phone_number_id, ''), latest.created_at desc;
$$;

grant execute on function public.get_whatsapp_conversations() to authenticated;
grant execute on function public.get_whatsapp_conversations() to service_role;

create view public.whatsapp_conversations
with (security_invoker = true) as
  select * from public.get_whatsapp_conversations();

grant select on public.whatsapp_conversations to authenticated;
grant select on public.whatsapp_conversations to service_role;
