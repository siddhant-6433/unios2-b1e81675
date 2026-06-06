-- Central WhatsApp channel registry. Secrets remain in Supabase env; this
-- table owns routing intent and sender identity so edge functions stop
-- duplicating phone/provider rules.

create table if not exists public.whatsapp_channels (
  id uuid primary key default gen_random_uuid(),
  label text not null,
  provider text not null check (provider in ('meta', 'plivo')),
  route text not null check (route in (
    'admissions',
    'reply',
    'otp',
    'call',
    'visit',
    'bulk',
    'hr',
    'plivo_admissions'
  )),
  business_number text,
  meta_phone_number_id text,
  secret_token_name text,
  is_active boolean not null default true,
  allow_ai boolean not null default true,
  allow_manual_reply boolean not null default true,
  allow_bulk boolean not null default false,
  quality_risk_level text not null default 'normal' check (quality_risk_level in ('normal', 'watch', 'restricted', 'disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.whatsapp_channels is
  'Registry of WhatsApp senders/routes across Meta Cloud API and Plivo BSP. secret_token_name points to a Supabase env var; token values are never stored here.';

comment on column public.whatsapp_channels.business_number is
  'Digits-only WhatsApp business sender number when known, e.g. 919555192192.';

comment on column public.whatsapp_channels.meta_phone_number_id is
  'Meta Cloud API phone-number ID for direct Graph sends. Null for Plivo channels and env-backed rows where the ID is only known at runtime.';

create index if not exists idx_whatsapp_channels_active_route
  on public.whatsapp_channels (is_active, route);

create index if not exists idx_whatsapp_channels_meta_phone
  on public.whatsapp_channels (meta_phone_number_id)
  where meta_phone_number_id is not null;

create index if not exists idx_whatsapp_channels_business_number
  on public.whatsapp_channels (business_number)
  where business_number is not null;

create unique index if not exists uniq_whatsapp_channels_provider_route_sender
  on public.whatsapp_channels (
    provider,
    route,
    coalesce(meta_phone_number_id, ''),
    coalesce(business_number, '')
  );

create or replace function public.set_whatsapp_channels_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_whatsapp_channels_updated_at on public.whatsapp_channels;
create trigger trg_whatsapp_channels_updated_at
  before update on public.whatsapp_channels
  for each row execute function public.set_whatsapp_channels_updated_at();

alter table public.whatsapp_channels enable row level security;

grant select on public.whatsapp_channels to authenticated;
grant select, insert, update on public.whatsapp_channels to service_role;

drop policy if exists "whatsapp_channels_staff_select" on public.whatsapp_channels;
create policy "whatsapp_channels_staff_select" on public.whatsapp_channels
  for select to authenticated using (true);

-- Meta channels are env-backed. Populate route rows so functions can resolve
-- sender intent from the DB, while runtime still falls back to the matching
-- WHATSAPP_*_PHONE_NUMBER_ID value when meta_phone_number_id is null.
insert into public.whatsapp_channels (
  label, provider, route, business_number, meta_phone_number_id,
  secret_token_name, allow_ai, allow_manual_reply, allow_bulk, quality_risk_level
) values
  ('Admissions default Meta sender', 'meta', 'admissions', null, null, 'WHATSAPP_API_TOKEN', true, true, false, 'normal'),
  ('CRM manual reply Meta sender', 'meta', 'reply', null, null, 'WHATSAPP_REPLY_API_TOKEN', true, true, false, 'normal'),
  ('OTP Meta sender', 'meta', 'otp', null, null, 'WHATSAPP_OTP_API_TOKEN', false, false, false, 'normal'),
  ('AI call follow-up Meta sender', 'meta', 'call', null, null, 'WHATSAPP_CALL_API_TOKEN', true, false, false, 'normal'),
  ('Visit Meta sender', 'meta', 'visit', null, null, 'WHATSAPP_VISIT_API_TOKEN', true, false, false, 'normal'),
  ('Bulk campaign Meta sender', 'meta', 'bulk', null, null, 'WHATSAPP_BULK_API_TOKEN', false, false, true, 'watch'),
  ('HR Meta sender', 'meta', 'hr', null, '970526789470416', 'WHATSAPP_API_TOKEN', false, true, false, 'normal'),
  ('Admissions Plivo coexistence sender 9555192192', 'plivo', 'plivo_admissions', '919555192192', null, null, true, true, false, 'normal')
on conflict do nothing;
