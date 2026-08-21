-- Bulk fee-due WhatsApp notifications with live late-fine payment links.
--
-- 1. Live-fee columns on payment_links so the /pay page recomputes base + fine
--    at pay-time instead of paying a stale snapshot.
-- 2. fee_notification_campaigns: audit/group for a bulk send (recipients are the
--    payment_links rows carrying the campaign id).
-- 3. Seed the ₹100/day late-fee policy for B.Ed Kotputli (BED-KT) year_2 tuition
--    so the fine is a real fee_ledger line, computed by fn_recompute_late_fees.

-- 1. payment_links: live-fee mode ------------------------------------------------
alter table public.payment_links
  add column if not exists live_fee boolean not null default false,
  add column if not exists fee_term text,
  add column if not exists fee_campaign_id uuid;

comment on column public.payment_links.live_fee is
  'When true, pay-link recomputes the amount from fee_ledger (base + late fine) at pay-time instead of using the stored amount.';
comment on column public.payment_links.fee_term is
  'For live_fee links: the fee_ledger term billed (e.g. year_2). Its late_<term> row is billed alongside.';

-- 2. fee_notification_campaigns --------------------------------------------------
create table if not exists public.fee_notification_campaigns (
  id            uuid primary key default gen_random_uuid(),
  created_by    uuid not null,
  filter        jsonb not null default '{}'::jsonb,
  fee_term      text not null,
  purpose_label text,
  expires_at    timestamptz,
  total         integer not null default 0,
  sent          integer not null default 0,
  failed        integer not null default 0,
  status        text not null default 'pending',   -- pending | sending | completed | failed
  created_at    timestamptz not null default now()
);

alter table public.payment_links
  drop constraint if exists payment_links_fee_campaign_id_fkey;
alter table public.payment_links
  add constraint payment_links_fee_campaign_id_fkey
  foreign key (fee_campaign_id) references public.fee_notification_campaigns(id) on delete set null;

create index if not exists idx_payment_links_fee_campaign
  on public.payment_links(fee_campaign_id) where fee_campaign_id is not null;

alter table public.fee_notification_campaigns enable row level security;

drop policy if exists "Staff can manage fee_notification_campaigns" on public.fee_notification_campaigns;
create policy "Staff can manage fee_notification_campaigns"
  on public.fee_notification_campaigns for all
  using (
    has_role(auth.uid(), 'super_admin'::app_role) or has_role(auth.uid(), 'campus_admin'::app_role)
    or has_role(auth.uid(), 'admission_head'::app_role) or has_role(auth.uid(), 'accountant'::app_role)
    or has_role(auth.uid(), 'counsellor'::app_role)
  )
  with check (
    has_role(auth.uid(), 'super_admin'::app_role) or has_role(auth.uid(), 'campus_admin'::app_role)
    or has_role(auth.uid(), 'admission_head'::app_role) or has_role(auth.uid(), 'accountant'::app_role)
    or has_role(auth.uid(), 'counsellor'::app_role)
  );

-- 3. B.Ed Kotputli year_2 late fine: ₹100/day, no grace, starting after the
--    31 Aug due date.
--
-- NOTE: we deliberately use the PER-HEAD late_fee_config on the year_2 ledger
-- rows, NOT a per-structure late_fee_policies row. fn_recompute_late_fees
-- (migration 20260801151019) floors the daily count on each row's OWN due_date
-- with no accrual_start_date, and a structure-wide policy would retroactively
-- fine the already-paid year_1 tuition (due 1 Apr) via its late payment date.
-- Scoping the config to year_2 fines only year_2, from its 31 Aug due date.
update public.fee_ledger fl
set late_fee_config = '{"penalty_type":"daily","penalty_amount":100,"grace_days":0}'::jsonb
from public.students st
join public.courses c on c.id = st.course_id
where fl.student_id = st.id
  and c.code = 'BED-KT'
  and fl.term = 'year_2'
  and fl.late_fee_config is distinct from '{"penalty_type":"daily","penalty_amount":100,"grace_days":0}'::jsonb;
