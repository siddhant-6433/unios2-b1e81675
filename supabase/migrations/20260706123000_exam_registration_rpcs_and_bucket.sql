-- Generic RPCs + storage bucket for the generalized exam_registrations table.
-- Mirrors the CAHET flow (cahet_mark_registered + cahet-registrations bucket)
-- but keyed by exam_code so every exam shares one code path.

-- ── Storage bucket for registration screenshots / PDFs ──────────────────────
insert into storage.buckets (id, name, public)
values ('exam-registrations', 'exam-registrations', false)
on conflict (id) do nothing;

drop policy if exists "Staff can upload exam docs" on storage.objects;
create policy "Staff can upload exam docs"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'exam-registrations' and (
      has_role(auth.uid(), 'super_admin'::app_role)
      or has_role(auth.uid(), 'campus_admin'::app_role)
      or has_role(auth.uid(), 'principal'::app_role)
      or has_role(auth.uid(), 'admission_head'::app_role)
      or has_role(auth.uid(), 'counsellor'::app_role)
    )
  );

drop policy if exists "Staff can view exam docs" on storage.objects;
create policy "Staff can view exam docs"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'exam-registrations' and (
      has_role(auth.uid(), 'super_admin'::app_role)
      or has_role(auth.uid(), 'campus_admin'::app_role)
      or has_role(auth.uid(), 'principal'::app_role)
      or has_role(auth.uid(), 'admission_head'::app_role)
      or has_role(auth.uid(), 'counsellor'::app_role)
    )
  );

-- ── exam_mark_registered: upsert a confirmed registration ───────────────────
create or replace function public.exam_mark_registered(
  p_lead_id uuid,
  p_exam_code text,
  p_registration_no text,
  p_document_url text default null,
  p_notes text default null
)
returns public.exam_registrations
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_row public.exam_registrations;
  v_profile_id uuid;
begin
  if p_lead_id is null or p_exam_code is null or p_registration_no is null
     or length(trim(p_registration_no)) = 0 then
    raise exception 'lead_id, exam_code and registration_no are required';
  end if;
  if p_exam_code not in ('cahet','cnet','updeled','jeecup','ptet','jee_bed','upget') then
    raise exception 'invalid exam_code: %', p_exam_code;
  end if;

  if not (
    public.has_role(auth.uid(), 'super_admin') or
    public.has_role(auth.uid(), 'campus_admin') or
    public.has_role(auth.uid(), 'principal') or
    public.has_role(auth.uid(), 'admission_head') or
    public.has_role(auth.uid(), 'counsellor')
  ) then
    raise exception 'not authorized to mark exam registrations';
  end if;

  select id into v_profile_id from public.profiles where user_id = auth.uid();

  insert into public.exam_registrations
    (lead_id, exam_code, status, registration_no, document_url, notes,
     registered_by, registered_at, answered_at)
  values
    (p_lead_id, p_exam_code, 'registered', trim(p_registration_no), p_document_url, p_notes,
     auth.uid(), now(), now())
  on conflict (lead_id, exam_code) do update set
    status          = 'registered',
    registration_no = excluded.registration_no,
    document_url    = coalesce(excluded.document_url, public.exam_registrations.document_url),
    notes           = coalesce(excluded.notes, public.exam_registrations.notes),
    registered_by   = auth.uid(),
    registered_at   = now(),
    answered_at     = now()
  returning * into v_row;

  insert into public.lead_activities (lead_id, user_id, type, description)
  values (p_lead_id, v_profile_id, 'system',
          upper(p_exam_code) || ' registration recorded (no: ' || trim(p_registration_no) || ')');

  return v_row;
end;
$function$;

-- ── exam_set_status: record not_registered / registered_no_number ───────────
create or replace function public.exam_set_status(
  p_lead_id uuid,
  p_exam_code text,
  p_status text,
  p_notes text default null
)
returns public.exam_registrations
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_row public.exam_registrations;
  v_profile_id uuid;
begin
  if p_status not in ('unknown','not_registered','registered_no_number','registered') then
    raise exception 'invalid status: %', p_status;
  end if;
  if p_exam_code not in ('cahet','cnet','updeled','jeecup','ptet','jee_bed','upget') then
    raise exception 'invalid exam_code: %', p_exam_code;
  end if;

  if not (
    public.has_role(auth.uid(), 'super_admin') or
    public.has_role(auth.uid(), 'campus_admin') or
    public.has_role(auth.uid(), 'principal') or
    public.has_role(auth.uid(), 'admission_head') or
    public.has_role(auth.uid(), 'counsellor')
  ) then
    raise exception 'not authorized to update exam registrations';
  end if;

  select id into v_profile_id from public.profiles where user_id = auth.uid();

  insert into public.exam_registrations
    (lead_id, exam_code, status, notes, answered_at)
  values (p_lead_id, p_exam_code, p_status, p_notes, now())
  on conflict (lead_id, exam_code) do update set
    status      = excluded.status,
    notes       = coalesce(excluded.notes, public.exam_registrations.notes),
    answered_at = now()
  returning * into v_row;

  insert into public.lead_activities (lead_id, user_id, type, description)
  values (p_lead_id, v_profile_id, 'system',
          upper(p_exam_code) || ' registration status set to ' || p_status);

  return v_row;
end;
$function$;
