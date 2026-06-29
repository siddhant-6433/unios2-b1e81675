-- WhatsApp AI quality loop: reviewed learning, SLA alerts, and eval catalog.

-- Keep the notification type check aligned with the types used by the app.
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (type in (
  'lead_assigned',
  'sla_warning',
  'lead_reclaimed',
  'followup_due',
  'followup_overdue',
  'visit_confirmation_due',
  'visit_followup_due',
  'lead_transferred',
  'deletion_request',
  'whatsapp_message',
  'whatsapp_sla_warning',
  'whatsapp_sla_breach',
  'approval_pending',
  'approval_decided',
  'template_status_update',
  'tat_defaults_report',
  'post_visit_nudge',
  'score_penalty',
  'feedback_received',
  'general'
));

alter table public.admissions_ai_reply_examples
  add column if not exists review_reason text,
  add column if not exists reviewed_by uuid references auth.users(id) on delete set null,
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewer_note text;

create index if not exists idx_admissions_ai_reply_examples_review_queue
  on public.admissions_ai_reply_examples (status, updated_at desc)
  where status = 'needs_review';

create or replace view public.admissions_ai_reply_review_queue as
select
  e.id,
  e.source_message_id,
  e.lead_id,
  l.name as lead_name,
  e.course_id,
  c.name as course_name,
  e.counsellor_id,
  p.display_name as counsellor_name,
  e.query_text,
  e.reply_text,
  e.language,
  e.tags,
  e.quality_score,
  e.review_reason,
  e.created_at,
  e.updated_at
from public.admissions_ai_reply_examples e
left join public.leads l on l.id = e.lead_id
left join public.courses c on c.id = e.course_id
left join public.profiles p on p.id = e.counsellor_id
where e.status = 'needs_review'
order by e.updated_at desc;

grant select on public.admissions_ai_reply_review_queue to authenticated;

create or replace function public.review_admissions_ai_reply_example(
  p_example_id uuid,
  p_decision text,
  p_quality_score numeric default null,
  p_reviewer_note text default null
)
returns public.admissions_ai_reply_examples
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user_id uuid := auth.uid();
  v_row public.admissions_ai_reply_examples;
begin
  if auth.role() <> 'service_role'
     and not public.has_role(v_user_id, 'super_admin')
     and not public.has_role(v_user_id, 'admission_head') then
    raise exception 'Only admissions admins can review AI reply examples';
  end if;

  if p_decision not in ('approve', 'reject') then
    raise exception 'p_decision must be approve or reject';
  end if;

  update public.admissions_ai_reply_examples
     set status = case when p_decision = 'approve' then 'active' else 'rejected' end,
         quality_score = coalesce(least(greatest(p_quality_score, 0), 1), quality_score),
         reviewed_by = v_user_id,
         reviewed_at = now(),
         reviewer_note = nullif(trim(coalesce(p_reviewer_note, '')), ''),
         updated_at = now()
   where id = p_example_id
   returning * into v_row;

  if v_row.id is null then
    raise exception 'AI reply example not found';
  end if;

  return v_row;
end;
$$;

grant execute on function public.review_admissions_ai_reply_example(uuid, text, numeric, text)
  to authenticated, service_role;

create table if not exists public.whatsapp_sla_alerts (
  id uuid primary key default gen_random_uuid(),
  phone text not null,
  provider text,
  business_number text,
  lead_id uuid references public.leads(id) on delete set null,
  user_id uuid references auth.users(id) on delete set null,
  alert_type text not null check (alert_type in ('warning', 'breach', 'reply_window_expiring')),
  last_inbound_at timestamptz not null,
  due_at timestamptz not null,
  notification_id uuid references public.notifications(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists idx_whatsapp_sla_alerts_user_created
  on public.whatsapp_sla_alerts (user_id, created_at desc);

create unique index if not exists idx_whatsapp_sla_alerts_dedupe
  on public.whatsapp_sla_alerts (phone, coalesce(business_number, ''), alert_type, last_inbound_at);

alter table public.whatsapp_sla_alerts enable row level security;

drop policy if exists "Admissions staff can view WhatsApp SLA alerts"
  on public.whatsapp_sla_alerts;

create policy "Admissions staff can view WhatsApp SLA alerts"
  on public.whatsapp_sla_alerts
  for select
  using (
    auth.uid() = user_id
    or public.has_role(auth.uid(), 'super_admin')
    or public.has_role(auth.uid(), 'admission_head')
  );

drop policy if exists "Service role can manage WhatsApp SLA alerts"
  on public.whatsapp_sla_alerts;

create policy "Service role can manage WhatsApp SLA alerts"
  on public.whatsapp_sla_alerts
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

grant select on public.whatsapp_sla_alerts to authenticated;
grant select, insert, update, delete on public.whatsapp_sla_alerts to service_role;

create or replace function public.create_whatsapp_sla_alerts(
  p_warning_after interval default interval '5 minutes',
  p_breach_after interval default interval '15 minutes',
  p_reply_window_expiring_within interval default interval '2 hours'
)
returns table (
  warnings_created integer,
  breaches_created integer,
  expiring_created integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_warning_count integer := 0;
  v_breach_count integer := 0;
  v_expiring_count integer := 0;
begin
  with conversations as (
    select
      wm.phone,
      max(wm.provider) as provider,
      coalesce(max(wm.business_phone_number), max(wm.business_phone_number_id), 'primary') as business_number,
      max(wm.lead_id) filter (where wm.lead_id is not null) as lead_id,
      max(wm.created_at) filter (where wm.direction = 'inbound') as last_inbound_at,
      max(wm.created_at) filter (where wm.direction = 'outbound') as last_outbound_at
    from public.whatsapp_messages wm
    where wm.created_at >= now() - interval '26 hours'
    group by wm.phone, coalesce(wm.business_phone_number, wm.business_phone_number_id, 'primary')
  ), actionable as (
    select
      c.*,
      l.counsellor_id,
      p.user_id,
      c.last_inbound_at + p_warning_after as warning_due_at,
      c.last_inbound_at + p_breach_after as breach_due_at,
      c.last_inbound_at + interval '24 hours' as reply_window_closes_at
    from conversations c
    left join public.leads l on l.id = c.lead_id
    left join public.profiles p on p.id = l.counsellor_id
    where c.last_inbound_at is not null
      and (c.last_outbound_at is null or c.last_outbound_at < c.last_inbound_at)
      and c.last_inbound_at + interval '24 hours' > now()
      and coalesce(l.stage::text, '') <> 'dnc'
      and p.user_id is not null
  ), warning_notifications as (
    insert into public.notifications (user_id, type, title, body, link, lead_id)
    select
      a.user_id,
      'whatsapp_sla_warning',
      'WhatsApp reply due',
      'Inbound WhatsApp message has not been replied to for 5 minutes. Reply while the Meta 24h window is open.',
      '/whatsapp-inbox',
      a.lead_id
    from actionable a
    where now() >= a.warning_due_at
      and not exists (
        select 1 from public.whatsapp_sla_alerts s
        where s.phone = a.phone
          and coalesce(s.business_number, '') = coalesce(a.business_number, '')
          and s.alert_type = 'warning'
          and s.last_inbound_at = a.last_inbound_at
      )
    returning id, user_id, lead_id
  ), warning_alerts as (
    insert into public.whatsapp_sla_alerts (phone, provider, business_number, lead_id, user_id, alert_type, last_inbound_at, due_at, notification_id)
    select a.phone, a.provider, a.business_number, a.lead_id, a.user_id, 'warning', a.last_inbound_at, a.warning_due_at, n.id
    from actionable a
    join warning_notifications n on n.user_id = a.user_id and n.lead_id is not distinct from a.lead_id
    where now() >= a.warning_due_at
    on conflict do nothing
    returning id
  )
  select count(*) into v_warning_count from warning_alerts;

  with conversations as (
    select
      wm.phone,
      max(wm.provider) as provider,
      coalesce(max(wm.business_phone_number), max(wm.business_phone_number_id), 'primary') as business_number,
      max(wm.lead_id) filter (where wm.lead_id is not null) as lead_id,
      max(wm.created_at) filter (where wm.direction = 'inbound') as last_inbound_at,
      max(wm.created_at) filter (where wm.direction = 'outbound') as last_outbound_at
    from public.whatsapp_messages wm
    where wm.created_at >= now() - interval '26 hours'
    group by wm.phone, coalesce(wm.business_phone_number, wm.business_phone_number_id, 'primary')
  ), actionable as (
    select
      c.*,
      l.counsellor_id,
      p.user_id,
      c.last_inbound_at + p_breach_after as breach_due_at,
      c.last_inbound_at + interval '24 hours' as reply_window_closes_at
    from conversations c
    left join public.leads l on l.id = c.lead_id
    left join public.profiles p on p.id = l.counsellor_id
    where c.last_inbound_at is not null
      and (c.last_outbound_at is null or c.last_outbound_at < c.last_inbound_at)
      and c.last_inbound_at + interval '24 hours' > now()
      and coalesce(l.stage::text, '') <> 'dnc'
      and p.user_id is not null
  ), breach_notifications as (
    insert into public.notifications (user_id, type, title, body, link, lead_id)
    select
      a.user_id,
      'whatsapp_sla_breach',
      'WhatsApp SLA breached',
      'Inbound WhatsApp message has waited 15 minutes without a reply. Prioritise this conversation now.',
      '/whatsapp-inbox',
      a.lead_id
    from actionable a
    where now() >= a.breach_due_at
      and not exists (
        select 1 from public.whatsapp_sla_alerts s
        where s.phone = a.phone
          and coalesce(s.business_number, '') = coalesce(a.business_number, '')
          and s.alert_type = 'breach'
          and s.last_inbound_at = a.last_inbound_at
      )
    returning id, user_id, lead_id
  ), breach_alerts as (
    insert into public.whatsapp_sla_alerts (phone, provider, business_number, lead_id, user_id, alert_type, last_inbound_at, due_at, notification_id)
    select a.phone, a.provider, a.business_number, a.lead_id, a.user_id, 'breach', a.last_inbound_at, a.breach_due_at, n.id
    from actionable a
    join breach_notifications n on n.user_id = a.user_id and n.lead_id is not distinct from a.lead_id
    where now() >= a.breach_due_at
    on conflict do nothing
    returning id
  )
  select count(*) into v_breach_count from breach_alerts;

  with conversations as (
    select
      wm.phone,
      max(wm.provider) as provider,
      coalesce(max(wm.business_phone_number), max(wm.business_phone_number_id), 'primary') as business_number,
      max(wm.lead_id) filter (where wm.lead_id is not null) as lead_id,
      max(wm.created_at) filter (where wm.direction = 'inbound') as last_inbound_at,
      max(wm.created_at) filter (where wm.direction = 'outbound') as last_outbound_at
    from public.whatsapp_messages wm
    where wm.created_at >= now() - interval '26 hours'
    group by wm.phone, coalesce(wm.business_phone_number, wm.business_phone_number_id, 'primary')
  ), actionable as (
    select
      c.*,
      l.counsellor_id,
      p.user_id,
      c.last_inbound_at + interval '24 hours' as reply_window_closes_at
    from conversations c
    left join public.leads l on l.id = c.lead_id
    left join public.profiles p on p.id = l.counsellor_id
    where c.last_inbound_at is not null
      and (c.last_outbound_at is null or c.last_outbound_at < c.last_inbound_at)
      and c.last_inbound_at + interval '24 hours' > now()
      and c.last_inbound_at + interval '24 hours' <= now() + p_reply_window_expiring_within
      and coalesce(l.stage::text, '') <> 'dnc'
      and p.user_id is not null
  ), expiring_notifications as (
    insert into public.notifications (user_id, type, title, body, link, lead_id)
    select
      a.user_id,
      'whatsapp_sla_warning',
      'WhatsApp 24h window expiring',
      'This conversation is unreplied and the Meta free-form reply window closes within 2 hours. Reply now or prepare an approved template.',
      '/whatsapp-inbox',
      a.lead_id
    from actionable a
    where not exists (
        select 1 from public.whatsapp_sla_alerts s
        where s.phone = a.phone
          and coalesce(s.business_number, '') = coalesce(a.business_number, '')
          and s.alert_type = 'reply_window_expiring'
          and s.last_inbound_at = a.last_inbound_at
      )
    returning id, user_id, lead_id
  ), expiring_alerts as (
    insert into public.whatsapp_sla_alerts (phone, provider, business_number, lead_id, user_id, alert_type, last_inbound_at, due_at, notification_id)
    select a.phone, a.provider, a.business_number, a.lead_id, a.user_id, 'reply_window_expiring', a.last_inbound_at, a.reply_window_closes_at, n.id
    from actionable a
    join expiring_notifications n on n.user_id = a.user_id and n.lead_id is not distinct from a.lead_id
    on conflict do nothing
    returning id
  )
  select count(*) into v_expiring_count from expiring_alerts;

  return query select v_warning_count, v_breach_count, v_expiring_count;
end;
$$;

grant execute on function public.create_whatsapp_sla_alerts(interval, interval, interval)
  to service_role;

create table if not exists public.whatsapp_golden_answer_evals (
  id text primary key,
  category text not null,
  language text not null default 'en',
  candidate_message text not null,
  expected_answer_notes text not null,
  required_terms text[] not null default '{}',
  forbidden_terms text[] not null default '{}',
  source_refs text[] not null default '{}',
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.whatsapp_golden_answer_evals enable row level security;

drop policy if exists "Admissions staff can view WhatsApp golden evals"
  on public.whatsapp_golden_answer_evals;

create policy "Admissions staff can view WhatsApp golden evals"
  on public.whatsapp_golden_answer_evals
  for select
  using (
    auth.uid() is not null
    and (
      public.has_role(auth.uid(), 'super_admin')
      or public.has_role(auth.uid(), 'campus_admin')
      or public.has_role(auth.uid(), 'admission_head')
      or public.has_role(auth.uid(), 'counsellor')
    )
  );

drop policy if exists "Admissions admins can manage WhatsApp golden evals"
  on public.whatsapp_golden_answer_evals;

create policy "Admissions admins can manage WhatsApp golden evals"
  on public.whatsapp_golden_answer_evals
  for all
  using (
    auth.role() = 'service_role'
    or public.has_role(auth.uid(), 'super_admin')
    or public.has_role(auth.uid(), 'admission_head')
  )
  with check (
    auth.role() = 'service_role'
    or public.has_role(auth.uid(), 'super_admin')
    or public.has_role(auth.uid(), 'admission_head')
  );

grant select on public.whatsapp_golden_answer_evals to authenticated;
grant select, insert, update, delete on public.whatsapp_golden_answer_evals to service_role;

insert into public.whatsapp_golden_answer_evals
  (id, category, language, candidate_message, expected_answer_notes, required_terms, forbidden_terms, source_refs)
values
  (
    'fee_bsc_nursing_en',
    'fees',
    'en',
    'What is the fee structure for B.Sc Nursing?',
    'Must answer with B.Sc Nursing first-year fee, mention Greater Noida where applicable, scholarships/loan support, and include canonical fee page.',
    array['B.Sc Nursing', '1,53,000', 'https://nimt.ac.in/admissions/fees/'],
    array['contact admissions for latest fee'],
    array['fee_structures', 'fee_structure_items', 'web-chat-server/knowledge.ts']
  ),
  (
    'fee_unknown_course_hinglish',
    'fees',
    'hinglish',
    'Fees kitni hai?',
    'Must share official fee page, ask for course/campus, and include compact popular fee examples without hallucinating a specific unknown course fee.',
    array['https://nimt.ac.in/admissions/fees/', 'course', 'campus'],
    array['I do not know', 'contact admissions only'],
    array['fee_structures', 'web-chat-server/knowledge.ts']
  ),
  (
    'eligibility_bpt_en',
    'eligibility',
    'en',
    'Am I eligible for BPT after 12th PCB?',
    'Must answer BPT eligibility from DB/eligibility rules: 10+2 PCB/English, minimum marks, CAHET counselling for UP 2026-27.',
    array['BPT', '10+2', 'PCB', 'CAHET'],
    array['NEET required'],
    array['eligibility_rules', 'courses.marketing_eligibility', 'web-chat-server/knowledge.ts']
  ),
  (
    'course_not_offered_mbbs',
    'course_not_offered',
    'en',
    'Do you have MBBS?',
    'Must clearly say NIMT does not currently offer MBBS and suggest relevant healthcare alternatives such as B.Sc Nursing, GNM, BPT, BMRIT, D.Pharma.',
    array['do not currently offer', 'B.Sc Nursing', 'BPT'],
    array['MBBS admission is open'],
    array['web-chat-server/knowledge.ts']
  )
on conflict (id) do update set
  category = excluded.category,
  language = excluded.language,
  candidate_message = excluded.candidate_message,
  expected_answer_notes = excluded.expected_answer_notes,
  required_terms = excluded.required_terms,
  forbidden_terms = excluded.forbidden_terms,
  source_refs = excluded.source_refs,
  is_active = true;
