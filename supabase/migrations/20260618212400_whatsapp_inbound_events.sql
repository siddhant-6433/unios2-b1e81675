-- Raw/normalized inbound webhook ledger.
-- whatsapp_messages is the user-facing inbox; this table is the provider
-- evidence trail used to debug missed leads, replay routing, and connect
-- replies to bulk/template outbound context.

create table if not exists public.whatsapp_inbound_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('meta', 'plivo')),
  provider_event_id text,
  phone text,
  business_number text,
  lead_id uuid references public.leads(id) on delete set null,
  message_id uuid references public.whatsapp_messages(id) on delete set null,
  event_kind text not null default 'inbound_message' check (event_kind in ('inbound_message', 'status_update', 'unknown')),
  message_type text,
  content_preview text,
  media_count integer not null default 0,
  raw_payload jsonb not null default '{}',
  normalized jsonb not null default '{}',
  processing_status text not null default 'received' check (processing_status in ('received', 'linked', 'skipped', 'error')),
  skip_reason text,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'whatsapp_inbound_events_provider_event_unique'
      and conrelid = 'public.whatsapp_inbound_events'::regclass
  ) then
    alter table public.whatsapp_inbound_events
      add constraint whatsapp_inbound_events_provider_event_unique
      unique (provider, provider_event_id);
  end if;
end
$$;

create index if not exists idx_whatsapp_inbound_events_phone_business_received
  on public.whatsapp_inbound_events (phone, coalesce(business_number, ''), received_at desc);

create index if not exists idx_whatsapp_inbound_events_message_id
  on public.whatsapp_inbound_events (message_id)
  where message_id is not null;

create index if not exists idx_whatsapp_inbound_events_status_received
  on public.whatsapp_inbound_events (processing_status, received_at desc);

alter table public.whatsapp_inbound_events enable row level security;

drop policy if exists "Staff can read whatsapp_inbound_events" on public.whatsapp_inbound_events;
create policy "Staff can read whatsapp_inbound_events"
  on public.whatsapp_inbound_events
  for select
  to authenticated
  using (true);

drop policy if exists "Service role can manage whatsapp_inbound_events" on public.whatsapp_inbound_events;
create policy "Service role can manage whatsapp_inbound_events"
  on public.whatsapp_inbound_events
  for all
  to service_role
  using (true)
  with check (true);
