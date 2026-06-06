-- Phase 5: structured course-wise admission briefs.
-- Content is intentionally not seeded here; course USP copy will be filled later.

create table if not exists public.course_admission_briefs (
  course_id uuid primary key references public.courses(id) on delete cascade,
  short_name text not null,
  positioning text,
  strongest_usp text,
  best_fit_lead text,
  bot_first_reply text,
  proof_points text[] not null default '{}',
  qualification_questions text[] not null default '{}',
  careers text[] not null default '{}',
  fee_summary text,
  source_url text,
  last_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_course_admission_briefs_short_name
  on public.course_admission_briefs (lower(short_name));

alter table public.course_admission_briefs enable row level security;

drop policy if exists "Authenticated users can view course admission briefs"
  on public.course_admission_briefs;

create policy "Authenticated users can view course admission briefs"
  on public.course_admission_briefs
  for select
  using (auth.uid() is not null);

drop policy if exists "Service role can manage course admission briefs"
  on public.course_admission_briefs;

create policy "Service role can manage course admission briefs"
  on public.course_admission_briefs
  for all
  using (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
