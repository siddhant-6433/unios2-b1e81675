-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260822082636 name=mobile_family_login_hardening applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

alter table public.whatsapp_otps
  add column if not exists attempts integer not null default 0;

insert into public.profiles (user_id, display_name, phone)
select s.user_id, nullif(s.name, ''), coalesce(nullif(s.phone,''), nullif(s.whatsapp_no,''))
from public.students s
where s.user_id is not null
on conflict (user_id) do nothing;

insert into public.profiles (user_id, display_name, phone)
select distinct on (s.father_user_id)
       s.father_user_id, nullif(s.father_name, ''), coalesce(nullif(s.father_phone,''), nullif(s.father_whatsapp,''))
from public.students s
where s.father_user_id is not null
order by s.father_user_id
on conflict (user_id) do nothing;

insert into public.profiles (user_id, display_name, phone)
select distinct on (s.mother_user_id)
       s.mother_user_id, nullif(s.mother_name, ''), coalesce(nullif(s.mother_phone,''), nullif(s.mother_whatsapp,''))
from public.students s
where s.mother_user_id is not null
order by s.mother_user_id
on conflict (user_id) do nothing;

insert into public.profiles (user_id, display_name, phone)
select distinct on (s.guardian_user_id)
       s.guardian_user_id, nullif(s.guardian_name, ''), nullif(s.guardian_phone,'')
from public.students s
where s.guardian_user_id is not null
order by s.guardian_user_id
on conflict (user_id) do nothing;
