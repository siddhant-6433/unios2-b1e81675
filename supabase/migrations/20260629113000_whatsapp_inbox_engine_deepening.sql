-- Server-side WhatsApp inbox and conversation-engine seams.
--
-- The UI should consume whatsapp_inbox_page/whatsapp_thread instead of
-- rebuilding read state, reply windows, and priority ordering in React.
-- The engine should process whatsapp_message_buffers so bursty inbound
-- messages produce one grounded reply/draft.

create table if not exists public.whatsapp_message_buffers (
  id uuid primary key default gen_random_uuid(),
  phone text not null,
  provider text not null default 'meta',
  business_number text not null default 'unknown',
  lead_id uuid references public.leads(id) on delete set null,
  first_message_at timestamptz not null,
  last_message_at timestamptz not null,
  due_at timestamptz not null,
  max_due_at timestamptz not null,
  message_ids uuid[] not null default '{}',
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'processed', 'cancelled', 'failed')),
  locked_at timestamptz,
  processed_at timestamptz,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists idx_whatsapp_message_buffers_one_pending
  on public.whatsapp_message_buffers (phone, provider, business_number)
  where status = 'pending';

create index if not exists idx_whatsapp_message_buffers_due
  on public.whatsapp_message_buffers (status, due_at)
  where status = 'pending';

create table if not exists public.whatsapp_ai_drafts (
  id uuid primary key default gen_random_uuid(),
  conversation_key text not null,
  phone text not null,
  provider text not null default 'meta',
  business_number text not null default 'unknown',
  lead_id uuid references public.leads(id) on delete set null,
  draft_text text not null,
  reason text not null,
  confidence numeric check (confidence is null or (confidence >= 0 and confidence <= 1)),
  grounding_refs jsonb not null default '[]'::jsonb,
  status text not null default 'open'
    check (status in ('open', 'approved', 'sent', 'dismissed', 'expired')),
  created_at timestamptz not null default now(),
  resolved_at timestamptz,
  resolved_by uuid
);

create index if not exists idx_whatsapp_ai_drafts_open
  on public.whatsapp_ai_drafts (status, created_at desc)
  where status = 'open';

alter table public.whatsapp_message_buffers enable row level security;
alter table public.whatsapp_ai_drafts enable row level security;

drop policy if exists "Admissions staff can view WhatsApp buffers"
  on public.whatsapp_message_buffers;
create policy "Admissions staff can view WhatsApp buffers"
  on public.whatsapp_message_buffers
  for select
  using (
    auth.role() = 'service_role'
    or public.has_role(auth.uid(), 'super_admin')
    or public.has_role(auth.uid(), 'admission_head')
    or public.has_role(auth.uid(), 'campus_admin')
    or public.has_role(auth.uid(), 'counsellor')
  );

drop policy if exists "Service role manages WhatsApp buffers"
  on public.whatsapp_message_buffers;
create policy "Service role manages WhatsApp buffers"
  on public.whatsapp_message_buffers
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

drop policy if exists "Admissions staff can view WhatsApp AI drafts"
  on public.whatsapp_ai_drafts;
create policy "Admissions staff can view WhatsApp AI drafts"
  on public.whatsapp_ai_drafts
  for select
  using (
    auth.role() = 'service_role'
    or public.has_role(auth.uid(), 'super_admin')
    or public.has_role(auth.uid(), 'admission_head')
    or public.has_role(auth.uid(), 'campus_admin')
    or public.has_role(auth.uid(), 'counsellor')
  );

drop policy if exists "Admissions admins can manage WhatsApp AI drafts"
  on public.whatsapp_ai_drafts;
create policy "Admissions admins can manage WhatsApp AI drafts"
  on public.whatsapp_ai_drafts
  for all
  using (
    auth.role() = 'service_role'
    or public.has_role(auth.uid(), 'super_admin')
    or public.has_role(auth.uid(), 'admission_head')
    or public.has_role(auth.uid(), 'campus_admin')
    or public.has_role(auth.uid(), 'counsellor')
  )
  with check (
    auth.role() = 'service_role'
    or public.has_role(auth.uid(), 'super_admin')
    or public.has_role(auth.uid(), 'admission_head')
    or public.has_role(auth.uid(), 'campus_admin')
    or public.has_role(auth.uid(), 'counsellor')
  );

grant select on public.whatsapp_message_buffers to authenticated;
grant all on public.whatsapp_message_buffers to service_role;
grant select, update on public.whatsapp_ai_drafts to authenticated;
grant all on public.whatsapp_ai_drafts to service_role;

create or replace function public.whatsapp_stable_conversation_key(
  p_phone text,
  p_provider text,
  p_business_number text
)
returns text
language sql
immutable
as $$
  select concat_ws(':',
    regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'),
    coalesce(nullif(p_provider, ''), 'meta'),
    coalesce(nullif(regexp_replace(coalesce(p_business_number, ''), '\D', '', 'g'), ''), 'unknown')
  );
$$;

grant execute on function public.whatsapp_stable_conversation_key(text, text, text)
  to authenticated, service_role;

create or replace function public.enqueue_whatsapp_message_buffer()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_provider text := coalesce(new.provider, 'meta');
  v_business text := coalesce(nullif(new.business_phone_number, ''), nullif(new.business_phone_number_id, ''), 'unknown');
  v_first timestamptz;
begin
  if new.direction <> 'inbound' then
    return new;
  end if;

  update public.whatsapp_message_buffers b
     set last_message_at = greatest(b.last_message_at, new.created_at),
         lead_id = coalesce(b.lead_id, new.lead_id),
         message_ids = case when new.id = any(b.message_ids) then b.message_ids else b.message_ids || new.id end,
         due_at = least(b.max_due_at, new.created_at + interval '10 seconds'),
         updated_at = now()
   where b.phone = new.phone
     and b.provider = v_provider
     and b.business_number = v_business
     and b.status = 'pending'
   returning b.first_message_at into v_first;

  if found then
    return new;
  end if;

  begin
    insert into public.whatsapp_message_buffers (
      phone, provider, business_number, lead_id,
      first_message_at, last_message_at, due_at, max_due_at, message_ids
    ) values (
      new.phone,
      v_provider,
      v_business,
      new.lead_id,
      new.created_at,
      new.created_at,
      new.created_at + interval '10 seconds',
      new.created_at + interval '60 seconds',
      array[new.id]
    );
  exception when unique_violation then
    update public.whatsapp_message_buffers b
       set last_message_at = greatest(b.last_message_at, new.created_at),
           lead_id = coalesce(b.lead_id, new.lead_id),
           message_ids = case when new.id = any(b.message_ids) then b.message_ids else b.message_ids || new.id end,
           due_at = least(b.max_due_at, new.created_at + interval '10 seconds'),
           updated_at = now()
     where b.phone = new.phone
       and b.provider = v_provider
       and b.business_number = v_business
       and b.status = 'pending';
  end;

  return new;
end;
$$;

drop trigger if exists trg_enqueue_whatsapp_message_buffer on public.whatsapp_messages;
create trigger trg_enqueue_whatsapp_message_buffer
after insert on public.whatsapp_messages
for each row
execute function public.enqueue_whatsapp_message_buffer();

create or replace function public.claim_due_whatsapp_buffers(p_limit integer default 25)
returns table (
  id uuid,
  phone text,
  provider text,
  business_number text,
  lead_id uuid,
  first_message_at timestamptz,
  last_message_at timestamptz,
  due_at timestamptz,
  max_due_at timestamptz,
  message_ids uuid[]
)
language sql
security definer
set search_path = public
as $$
  with due as (
    select b.id
    from public.whatsapp_message_buffers b
    where b.status = 'pending'
      and b.due_at <= now()
    order by b.due_at asc
    limit least(greatest(coalesce(p_limit, 25), 1), 100)
    for update skip locked
  ), claimed as (
    update public.whatsapp_message_buffers b
       set status = 'processing',
           locked_at = now(),
           updated_at = now()
      from due
     where b.id = due.id
     returning b.*
  )
  select
    claimed.id,
    claimed.phone,
    claimed.provider,
    claimed.business_number,
    claimed.lead_id,
    claimed.first_message_at,
    claimed.last_message_at,
    claimed.due_at,
    claimed.max_due_at,
    claimed.message_ids
  from claimed;
$$;

grant execute on function public.claim_due_whatsapp_buffers(integer) to service_role;

create or replace function public.whatsapp_inbox_page(
  p_scope text default 'inbox',
  p_business_number text default 'all',
  p_counsellor_filter text default 'all',
  p_ops_filter text default 'all',
  p_cursor_at timestamptz default null,
  p_cursor_phone text default null,
  p_limit integer default 120
)
returns table (
  phone text,
  provider text,
  business_number text,
  conversation_key text,
  lead_id uuid,
  lead_name text,
  lead_stage text,
  lead_person_role text,
  lead_source text,
  course_name text,
  counsellor_id uuid,
  counsellor_name text,
  lead_temperature text,
  lead_score integer,
  last_message text,
  last_direction text,
  last_message_at timestamptz,
  last_inbound_at timestamptz,
  last_outbound_at timestamptz,
  unread_count integer,
  unreplied_count integer,
  reply_window_expires_at timestamptz,
  reply_window_open boolean,
  priority_rank integer,
  conversation_mode text,
  conversation_state text,
  handoff_reason text,
  last_bot_action text,
  render_preview jsonb
)
language sql
security definer
set search_path = public
as $$
  with base as (
    select
      wc.*,
      coalesce(nullif(wc.business_phone_number, ''), nullif(wc.business_phone_number_id, ''), 'unknown') as resolved_business_number,
      l.lead_score,
      l.lead_temperature,
      (
        select max(m.created_at)
        from public.whatsapp_messages m
        where m.phone = wc.phone
          and m.direction = 'inbound'
          and coalesce(m.provider, 'meta') = coalesce(wc.provider, 'meta')
          and coalesce(nullif(m.business_phone_number, ''), nullif(m.business_phone_number_id, ''), 'unknown')
            = coalesce(nullif(wc.business_phone_number, ''), nullif(wc.business_phone_number_id, ''), 'unknown')
      ) as last_inbound_at,
      (
        select max(m.created_at)
        from public.whatsapp_messages m
        where m.phone = wc.phone
          and m.direction = 'outbound'
          and coalesce(m.provider, 'meta') = coalesce(wc.provider, 'meta')
          and coalesce(nullif(m.business_phone_number, ''), nullif(m.business_phone_number_id, ''), 'unknown')
            = coalesce(nullif(wc.business_phone_number, ''), nullif(wc.business_phone_number_id, ''), 'unknown')
      ) as last_outbound_at,
      (
        select m.render_metadata
        from public.whatsapp_messages m
        where m.phone = wc.phone
          and m.message_type = 'template'
          and m.render_metadata is not null
        order by m.created_at desc
        limit 1
      ) as latest_render_metadata
    from public.whatsapp_conversations wc
    left join public.leads l on l.id = wc.lead_id
  ), scored as (
    select
      base.*,
      (base.last_inbound_at + interval '24 hours') as reply_window_expires_at,
      (base.last_inbound_at is not null and base.last_inbound_at + interval '24 hours' > now()) as reply_window_open,
      case
        when base.last_direction = 'inbound'
          and base.last_inbound_at is not null
          and base.last_inbound_at + interval '24 hours' > now()
          then 1
        when base.last_direction = 'inbound' then 2
        when base.conversation_state = 'knowledge_gap' or base.last_bot_action = 'knowledge_gap' then 3
        when base.handoff_reason is not null or base.conversation_mode = 'human' then 4
        else 9
      end as priority_rank,
      case
        when base.last_direction = 'inbound'
          and (base.last_outbound_at is null or base.last_outbound_at < base.last_inbound_at)
          then 1
        else 0
      end as unreplied_count
    from base
  )
  select
    scored.phone,
    coalesce(scored.provider, 'meta')::text,
    scored.resolved_business_number::text,
    public.whatsapp_stable_conversation_key(scored.phone, coalesce(scored.provider, 'meta'), scored.resolved_business_number),
    scored.lead_id,
    scored.lead_name,
    scored.lead_stage,
    scored.lead_person_role,
    scored.lead_source,
    scored.course_name,
    scored.counsellor_id,
    scored.counsellor_name,
    scored.lead_temperature,
    scored.lead_score,
    scored.last_message,
    scored.last_direction,
    scored.last_message_at,
    scored.last_inbound_at,
    scored.last_outbound_at,
    scored.unread_count::integer,
    scored.unreplied_count::integer,
    scored.reply_window_expires_at,
    scored.reply_window_open,
    scored.priority_rank::integer,
    scored.conversation_mode,
    scored.conversation_state,
    scored.handoff_reason,
    scored.last_bot_action,
    scored.latest_render_metadata
  from scored
  where
    (coalesce(p_scope, 'inbox') <> 'outbound' or scored.has_inbound = false)
    and (coalesce(p_scope, 'inbox') = 'outbound' or scored.has_inbound = true)
    and (
      coalesce(p_business_number, 'all') = 'all'
      or scored.resolved_business_number = p_business_number
      or regexp_replace(scored.resolved_business_number, '\D', '', 'g') = regexp_replace(p_business_number, '\D', '', 'g')
    )
    and (
      coalesce(p_counsellor_filter, 'all') = 'all'
      or (p_counsellor_filter = 'unassigned' and scored.counsellor_id is null)
      or scored.counsellor_id::text = p_counsellor_filter
    )
    and (
      coalesce(p_ops_filter, 'all') = 'all'
      or (p_ops_filter = 'reply_window' and scored.priority_rank = 1)
      or (p_ops_filter = 'handoff' and (scored.handoff_reason is not null or scored.conversation_mode = 'human'))
      or (p_ops_filter = 'knowledge' and (scored.conversation_state = 'knowledge_gap' or scored.last_bot_action = 'knowledge_gap'))
      or (p_ops_filter = 'unassigned' and scored.counsellor_id is null and scored.has_inbound)
      or (p_ops_filter = 'sla' and scored.sla_due_at is not null and scored.sla_due_at < now())
    )
    and (
      p_cursor_at is null
      or scored.last_message_at < p_cursor_at
      or (scored.last_message_at = p_cursor_at and scored.phone < coalesce(p_cursor_phone, ''))
    )
  order by
    scored.priority_rank asc,
    case scored.lead_temperature when 'hot' then 1 when 'warm' then 2 when 'cold' then 3 else 4 end asc,
    scored.reply_window_expires_at asc nulls last,
    scored.last_message_at desc,
    scored.phone desc
  limit least(greatest(coalesce(p_limit, 120), 1), 250);
$$;

grant execute on function public.whatsapp_inbox_page(text, text, text, text, timestamptz, text, integer)
  to authenticated, service_role;

create or replace function public.whatsapp_thread(
  p_phone text,
  p_provider text default null,
  p_business_number text default null,
  p_before timestamptz default null,
  p_limit integer default 200
)
returns table (
  id uuid,
  wa_message_id text,
  direction text,
  content text,
  message_type text,
  status text,
  template_key text,
  media_url text,
  created_at timestamptz,
  provider text,
  business_phone_number_id text,
  business_phone_number text,
  sender_user_id uuid,
  status_error jsonb,
  render_metadata jsonb
)
language sql
security definer
set search_path = public
as $$
  select
    m.id,
    m.wa_message_id,
    m.direction,
    m.content,
    m.message_type,
    m.status,
    m.template_key,
    m.media_url,
    m.created_at,
    coalesce(m.provider, 'meta')::text,
    m.business_phone_number_id,
    m.business_phone_number,
    m.sender_user_id,
    m.status_error,
    m.render_metadata
  from public.whatsapp_messages m
  where m.phone = regexp_replace(coalesce(p_phone, ''), '\D', '', 'g')
    and (p_provider is null or coalesce(m.provider, 'meta') = p_provider)
    and (
      p_business_number is null
      or coalesce(nullif(m.business_phone_number, ''), nullif(m.business_phone_number_id, ''), 'unknown') = p_business_number
      or regexp_replace(coalesce(nullif(m.business_phone_number, ''), nullif(m.business_phone_number_id, ''), ''), '\D', '', 'g')
        = regexp_replace(p_business_number, '\D', '', 'g')
    )
    and (p_before is null or m.created_at < p_before)
  order by m.created_at desc
  limit least(greatest(coalesce(p_limit, 200), 1), 500);
$$;

grant execute on function public.whatsapp_thread(text, text, text, timestamptz, integer)
  to authenticated, service_role;
