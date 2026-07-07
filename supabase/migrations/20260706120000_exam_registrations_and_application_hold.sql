-- Generalized entrance-exam / counselling registration tracking + an
-- "on hold (ineligible)" application stage.
--
-- Replaces the per-exam clones (cahet_registrations, updeled_registrations,
-- plus the UPGET-from-metadata path) with a single exam_registrations table
-- keyed by (lead_id, exam_code). The old tables are LEFT IN PLACE and are
-- backfilled into the new table so nothing breaks during transition; they can
-- be dropped in a later migration once all read paths move over.
--
-- Exam codes: cahet, cnet, updeled, jeecup, ptet, jee_bed, upget
-- (course→exam mapping lives in src/lib/examRegistration.ts).

-- ── exam_registrations ──────────────────────────────────────────────────────
create table if not exists public.exam_registrations (
  id              uuid primary key default gen_random_uuid(),
  lead_id         uuid not null references public.leads(id) on delete cascade,
  exam_code       text not null
                    check (exam_code in ('cahet','cnet','updeled','jeecup','ptet','jee_bed','upget')),
  -- unknown: not yet known; not_registered: candidate said no;
  -- registered_no_number: said yes but no number yet; registered: number captured.
  status          text not null default 'unknown'
                    check (status in ('unknown','not_registered','registered_no_number','registered')),
  registration_no text,
  document_url    text,
  notes           text,
  -- Intake-cron bookkeeping: when we last asked over WhatsApp and how many
  -- times (capped at 2 asks per lead).
  asked_at        timestamptz,
  ask_count       integer not null default 0,
  answered_at     timestamptz,
  registered_at   timestamptz,
  registered_by   uuid references auth.users(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (lead_id, exam_code)
);

create index if not exists idx_exam_registrations_lead
  on public.exam_registrations (lead_id);
create index if not exists idx_exam_registrations_exam_status
  on public.exam_registrations (exam_code, status);
-- Cron sweep target: leads still unknown that we may still ask.
create index if not exists idx_exam_registrations_unknown_pending
  on public.exam_registrations (exam_code)
  where status = 'unknown' and ask_count < 2;

comment on table public.exam_registrations is
  'One row per (lead, entrance exam). Generalizes cahet/updeled/upget registration tracking. exam_code maps from course+campus via src/lib/examRegistration.ts.';

-- updated_at touch trigger (per-table, matching this codebase''s convention)
create or replace function public._exam_registrations_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists trg_exam_registrations_updated_at on public.exam_registrations;
create trigger trg_exam_registrations_updated_at
  before update on public.exam_registrations
  for each row execute function public._exam_registrations_touch_updated_at();

-- ── RLS ─────────────────────────────────────────────────────────────────────
alter table public.exam_registrations enable row level security;

drop policy if exists "Staff can view exam registrations" on public.exam_registrations;
create policy "Staff can view exam registrations"
  on public.exam_registrations for select to authenticated
  using (
    has_role(auth.uid(), 'super_admin'::app_role)
    or has_role(auth.uid(), 'campus_admin'::app_role)
    or has_role(auth.uid(), 'principal'::app_role)
    or has_role(auth.uid(), 'admission_head'::app_role)
    or has_role(auth.uid(), 'counsellor'::app_role)
  );

drop policy if exists "Staff can insert exam registrations" on public.exam_registrations;
create policy "Staff can insert exam registrations"
  on public.exam_registrations for insert to authenticated
  with check (
    has_role(auth.uid(), 'super_admin'::app_role)
    or has_role(auth.uid(), 'campus_admin'::app_role)
    or has_role(auth.uid(), 'principal'::app_role)
    or has_role(auth.uid(), 'admission_head'::app_role)
    or has_role(auth.uid(), 'counsellor'::app_role)
  );

-- Update is open to the same staff set that captures CAHET/UPDELED numbers
-- today (incl. counsellors) so registration details can be entered inline.
drop policy if exists "Staff can update exam registrations" on public.exam_registrations;
create policy "Staff can update exam registrations"
  on public.exam_registrations for update to authenticated
  using (
    has_role(auth.uid(), 'super_admin'::app_role)
    or has_role(auth.uid(), 'campus_admin'::app_role)
    or has_role(auth.uid(), 'principal'::app_role)
    or has_role(auth.uid(), 'admission_head'::app_role)
    or has_role(auth.uid(), 'counsellor'::app_role)
  );

-- ── Backfill from the legacy per-exam tables ────────────────────────────────
-- Existing rows in cahet/updeled are confirmed registrations (they hold a
-- registration_no), so they land as status='registered'.
insert into public.exam_registrations
  (lead_id, exam_code, status, registration_no, document_url, notes,
   registered_at, registered_by, created_at, answered_at)
select lead_id, 'cahet', 'registered', registration_no, document_url, notes,
       registered_at,
       (select u.id from auth.users u where u.id = c.registered_by),
       created_at, registered_at
from public.cahet_registrations c
on conflict (lead_id, exam_code) do nothing;

insert into public.exam_registrations
  (lead_id, exam_code, status, registration_no, document_url, notes,
   registered_at, registered_by, created_at, answered_at)
select lead_id, 'updeled', 'registered', registration_no, document_url, notes,
       registered_at,
       (select u.id from auth.users u where u.id = c.registered_by),
       created_at, registered_at
from public.updeled_registrations c
on conflict (lead_id, exam_code) do nothing;

-- ── Application "on hold (ineligible)" stage ────────────────────────────────
-- applications.status is free text (no enum/constraint), so 'on_hold' needs no
-- type change — just supporting columns for the reason and audit trail.
alter table public.applications
  add column if not exists hold_reason text,
  add column if not exists held_at    timestamptz,
  add column if not exists held_by     uuid references auth.users(id) on delete set null;

comment on column public.applications.hold_reason is
  'Set when status=''on_hold'': why the application was put on hold (e.g. not registered for the required entrance exam / does not meet eligibility).';
