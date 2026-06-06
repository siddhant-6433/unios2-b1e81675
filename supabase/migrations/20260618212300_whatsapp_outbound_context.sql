-- Conversation-engine bridge for outbound WhatsApp sends.
-- A reply to a template/bulk/manual message needs to know what initiated the
-- thread: campaign, lifecycle template, manual counsellor reply, post-call
-- nudge, etc. whatsapp_messages keeps visibility; this table keeps intent.

create table if not exists public.whatsapp_outbound_context (
  id uuid primary key default gen_random_uuid(),
  message_id uuid references public.whatsapp_messages(id) on delete cascade,
  provider_message_id text,
  phone text not null,
  business_number text,
  provider text check (provider in ('meta', 'plivo')),
  lead_id uuid references public.leads(id) on delete set null,
  campaign_id uuid references public.whatsapp_campaigns(id) on delete set null,
  campaign_recipient_id uuid references public.whatsapp_campaign_recipients(id) on delete set null,
  template_key text,
  outbound_kind text not null check (outbound_kind in (
    'manual_reply',
    'ai_reply',
    'auto_reply',
    'template',
    'bulk_campaign',
    'system_notification'
  )),
  expected_reply_type text not null default 'general' check (expected_reply_type in (
    'general',
    'admission_query',
    'callback_request',
    'course_interest',
    'feedback',
    'payment',
    'application',
    'do_not_reply'
  )),
  response_policy text not null default 'engine' check (response_policy in (
    'engine',
    'human',
    'suppress'
  )),
  metadata jsonb not null default '{}',
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_wa_outbound_context_lookup
  on public.whatsapp_outbound_context (phone, coalesce(business_number, ''), created_at desc);

create index if not exists idx_wa_outbound_context_campaign
  on public.whatsapp_outbound_context (campaign_id, created_at desc)
  where campaign_id is not null;

create index if not exists idx_wa_outbound_context_recipient
  on public.whatsapp_outbound_context (campaign_recipient_id)
  where campaign_recipient_id is not null;

create unique index if not exists uniq_wa_outbound_context_message
  on public.whatsapp_outbound_context (message_id)
  where message_id is not null;

alter table public.whatsapp_outbound_context enable row level security;

grant select on public.whatsapp_outbound_context to authenticated;
grant select, insert, update on public.whatsapp_outbound_context to service_role;

drop policy if exists "whatsapp_outbound_context_staff_select"
  on public.whatsapp_outbound_context;

create policy "whatsapp_outbound_context_staff_select"
  on public.whatsapp_outbound_context
  for select to authenticated
  using (true);

drop policy if exists "whatsapp_outbound_context_service_manage"
  on public.whatsapp_outbound_context;

create policy "whatsapp_outbound_context_service_manage"
  on public.whatsapp_outbound_context
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
