-- Self-improving knowledge loop for the NIMT voice agent (Navya).
--
-- When the AI cannot answer a caller's question confidently, it flags the
-- question here (via the flag_knowledge_gap tool, or post-call mining of
-- "senior counsellor se confirm" phrases). Admins answer them, and the
-- answers feed back into the admissions reply memory over time.

create table if not exists public.voice_knowledge_gaps (
  id uuid primary key default gen_random_uuid(),
  call_id uuid references public.ai_call_records(id) on delete set null,
  lead_id uuid references public.leads(id) on delete set null,
  course_id uuid references public.courses(id) on delete set null,
  question_text text not null,
  ai_answer_given text,
  transcript_snippet text,
  status text not null default 'pending'
    check (status in ('pending', 'answered', 'dismissed')),
  admin_answer text,
  answered_by uuid references public.profiles(id),
  answered_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists idx_voice_knowledge_gaps_status_created
  on public.voice_knowledge_gaps (status, created_at desc);

alter table public.voice_knowledge_gaps enable row level security;

drop policy if exists "Admissions leads can view voice knowledge gaps"
  on public.voice_knowledge_gaps;

create policy "Admissions leads can view voice knowledge gaps"
  on public.voice_knowledge_gaps
  for select
  using (
    auth.uid() is not null
    and (
      public.has_role(auth.uid(), 'super_admin')
      or public.has_role(auth.uid(), 'admission_head')
      or public.has_role(auth.uid(), 'campus_admin')
    )
  );

drop policy if exists "Admissions admins can manage voice knowledge gaps"
  on public.voice_knowledge_gaps;

create policy "Admissions admins can manage voice knowledge gaps"
  on public.voice_knowledge_gaps
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

grant select on public.voice_knowledge_gaps to authenticated;
grant select, insert, update, delete on public.voice_knowledge_gaps to service_role;

comment on table public.voice_knowledge_gaps is
  'Questions the NIMT voice agent could not answer confidently, forwarded to senior counsellors for a verified answer.';
