-- Organisation-specific admissions AI reply memory.
--
-- This is intentionally retrieval-first, not fine-tuning. We keep approved
-- counsellor replies and other reviewed admissions interactions as examples,
-- match them at response time, and inject the closest examples into channel
-- agents such as WhatsApp and voice.

create extension if not exists pg_trgm;

create table if not exists public.admissions_ai_reply_examples (
  id uuid primary key default gen_random_uuid(),
  source_message_id uuid unique references public.whatsapp_messages(id) on delete set null,
  lead_id uuid references public.leads(id) on delete set null,
  course_id uuid references public.courses(id) on delete set null,
  counsellor_id uuid references public.profiles(id) on delete set null,
  source_channel text not null default 'whatsapp'
    check (source_channel in ('whatsapp', 'voice', 'manual_note', 'template', 'course_brief')),
  target_channels text[] not null default '{whatsapp,voice}',
  phone text,
  query_text text not null,
  reply_text text not null,
  language text not null default 'unknown',
  tags text[] not null default '{}',
  status text not null default 'needs_review'
    check (status in ('active', 'needs_review', 'rejected')),
  quality_score numeric not null default 0.65
    check (quality_score >= 0 and quality_score <= 1),
  use_count integer not null default 0,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_whatsapp_reply_examples_status_course
  on public.admissions_ai_reply_examples (status, course_id, quality_score desc);

create index if not exists idx_admissions_ai_reply_examples_target_channels
  on public.admissions_ai_reply_examples using gin (target_channels);

create index if not exists idx_whatsapp_reply_examples_query_trgm
  on public.admissions_ai_reply_examples using gin (query_text gin_trgm_ops);

create index if not exists idx_whatsapp_reply_examples_reply_trgm
  on public.admissions_ai_reply_examples using gin (reply_text gin_trgm_ops);

alter table public.admissions_ai_reply_examples enable row level security;

drop policy if exists "Admissions staff can view WhatsApp reply examples"
  on public.admissions_ai_reply_examples;

create policy "Admissions staff can view WhatsApp reply examples"
  on public.admissions_ai_reply_examples
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

drop policy if exists "Admissions admins can manage WhatsApp reply examples"
  on public.admissions_ai_reply_examples;

create policy "Admissions admins can manage WhatsApp reply examples"
  on public.admissions_ai_reply_examples
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

grant select on public.admissions_ai_reply_examples to authenticated;
grant select, insert, update, delete on public.admissions_ai_reply_examples to service_role;

create or replace function public.match_admissions_ai_reply_examples(
  p_query text,
  p_course_id uuid default null,
  p_target_channel text default 'whatsapp',
  p_limit integer default 3
)
returns table (
  id uuid,
  query_text text,
  reply_text text,
  course_id uuid,
  source_channel text,
  target_channels text[],
  language text,
  tags text[],
  quality_score numeric,
  score numeric
)
language sql
stable
security definer
set search_path = public, extensions
as $$
  select
    wre.id,
    wre.query_text,
    wre.reply_text,
    wre.course_id,
    wre.source_channel,
    wre.target_channels,
    wre.language,
    wre.tags,
    wre.quality_score,
    (
      greatest(
        similarity(lower(coalesce(p_query, '')), lower(wre.query_text)),
        similarity(lower(coalesce(p_query, '')), lower(wre.reply_text)) * 0.65
      )
      + case when p_course_id is not null and wre.course_id = p_course_id then 0.20 else 0 end
      + (wre.quality_score * 0.10)
    )::numeric as score
  from public.admissions_ai_reply_examples wre
  where wre.status = 'active'
    and length(coalesce(p_query, '')) >= 3
    and coalesce(p_target_channel, 'whatsapp') = any(wre.target_channels)
    and (
      lower(wre.query_text) % lower(p_query)
      or lower(wre.reply_text) % lower(p_query)
      or (p_course_id is not null and wre.course_id = p_course_id)
    )
  order by score desc, wre.quality_score desc, wre.updated_at desc
  limit least(greatest(coalesce(p_limit, 3), 1), 5);
$$;

grant execute on function public.match_admissions_ai_reply_examples(text, uuid, text, integer)
  to authenticated, service_role;

comment on table public.admissions_ai_reply_examples is
  'Approved and reviewable examples mined from admissions interactions for retrieval-augmented AI replies across WhatsApp and voice.';

comment on function public.match_admissions_ai_reply_examples(text, uuid, text, integer) is
  'Returns active organisation-specific admissions reply examples matching a new lead query for a target channel.';
