-- Phase 4: auditable WhatsApp automation decisions.

create table if not exists public.whatsapp_automation_events (
  id uuid primary key default gen_random_uuid(),
  phone text not null,
  business_number text,
  provider text check (provider in ('meta', 'plivo')),
  lead_id uuid references public.leads(id) on delete set null,
  message_id uuid references public.whatsapp_messages(id) on delete set null,
  event_type text not null,
  decision text,
  reason text,
  confidence numeric,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);

create index if not exists idx_wa_automation_events_phone_created
  on public.whatsapp_automation_events (phone, created_at desc);

create index if not exists idx_wa_automation_events_business_created
  on public.whatsapp_automation_events (business_number, created_at desc);

create index if not exists idx_wa_automation_events_type_created
  on public.whatsapp_automation_events (event_type, created_at desc);

create index if not exists idx_wa_automation_events_lead_created
  on public.whatsapp_automation_events (lead_id, created_at desc)
  where lead_id is not null;

alter table public.whatsapp_automation_events enable row level security;

drop policy if exists "Authenticated users can view whatsapp automation events"
  on public.whatsapp_automation_events;

create policy "Authenticated users can view whatsapp automation events"
  on public.whatsapp_automation_events
  for select
  using (auth.uid() is not null);

drop policy if exists "Service role can manage whatsapp automation events"
  on public.whatsapp_automation_events;

create policy "Service role can manage whatsapp automation events"
  on public.whatsapp_automation_events
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
