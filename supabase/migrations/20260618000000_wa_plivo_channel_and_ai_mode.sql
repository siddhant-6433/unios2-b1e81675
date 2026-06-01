-- Second WhatsApp number (9555192192) runs through Plivo in COEXISTENCE mode:
-- the number stays live in the WhatsApp Business app AND is reachable over the
-- Plivo BSP API. Inbound traffic for it lands on a separate edge function
-- (whatsapp-plivo-webhook) because Plivo's API/webhook shape differs from
-- Meta's Graph API. Two schema additions support that:
--
--   1. whatsapp_messages.provider — tags each row 'meta' (existing direct Cloud
--      API path) vs 'plivo' (BSP path) so the reply path knows which sender to
--      use. Defaults to 'meta' so every existing row + insert is unchanged.
--
--   2. whatsapp_ai_mode — per-(phone, business_number) guard that toggles a
--      conversation between AI auto-reply and human handling. Generalises the
--      existing "counsellor replied in last 30 min → AI backs off" heuristic
--      into an explicit, sticky switch a counsellor can flip from the inbox.

-- ── 1. provider tag on messages ──────────────────────────────────────────────
alter table public.whatsapp_messages
  add column if not exists provider text not null default 'meta';

comment on column public.whatsapp_messages.provider is
  'Messaging provider for this row: ''meta'' (direct WhatsApp Cloud API) or ''plivo'' (Plivo BSP / coexistence number).';

create index if not exists idx_wa_messages_provider
  on public.whatsapp_messages (provider);

-- ── 2. per-conversation AI vs human mode ─────────────────────────────────────
create table if not exists public.whatsapp_ai_mode (
  phone           text not null,
  business_number text not null,
  mode            text not null default 'ai' check (mode in ('ai', 'human')),
  updated_at      timestamptz not null default now(),
  updated_by      uuid references auth.users (id) on delete set null,
  primary key (phone, business_number)
);

comment on table public.whatsapp_ai_mode is
  'Per-conversation guard: when mode = ''human'', the bot stops auto-replying on that (phone, business_number) and humans handle it (inbox or WhatsApp Business app). Defaults to ''ai''.';

alter table public.whatsapp_ai_mode enable row level security;

-- Edge functions use the service_role key (bypasses RLS) but still need table
-- privileges — granted explicitly here, mirroring the feedback_responses fix.
grant select, insert, update on public.whatsapp_ai_mode to service_role;
grant select, insert, update on public.whatsapp_ai_mode to authenticated;

-- Authenticated staff can read and flip the mode for any conversation.
drop policy if exists "wa_ai_mode_select" on public.whatsapp_ai_mode;
create policy "wa_ai_mode_select" on public.whatsapp_ai_mode
  for select to authenticated using (true);

drop policy if exists "wa_ai_mode_insert" on public.whatsapp_ai_mode;
create policy "wa_ai_mode_insert" on public.whatsapp_ai_mode
  for insert to authenticated with check (true);

drop policy if exists "wa_ai_mode_update" on public.whatsapp_ai_mode;
create policy "wa_ai_mode_update" on public.whatsapp_ai_mode
  for update to authenticated using (true) with check (true);
