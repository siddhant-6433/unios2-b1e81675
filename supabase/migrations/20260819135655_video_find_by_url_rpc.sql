-- keep-migration-version: already recorded on production schema_migrations
-- Backfilled from production schema_migrations.
-- version=20260819135655 name=video_find_by_url_rpc applied_by=siddhant@nimt.ac.in
-- Git must keep this timestamp so `db push` matches remote history.

create or replace function public.find_video_by_url(p_url text)
returns table (
  id uuid,
  title text,
  brand text,
  status text,
  editor_name text,
  created_at timestamptz,
  matched_field text
)
language sql
security definer
set search_path = public
stable
as $$
  with norm as (select lower(rtrim(btrim(p_url), '/')) as u)
  select v.id, v.title, v.brand::text, v.status::text,
         e.name as editor_name, v.created_at,
         case
           when lower(rtrim(v.drive_url, '/'))     = norm.u then 'drive'
           when lower(rtrim(v.instagram_url, '/')) = norm.u then 'instagram'
           when lower(rtrim(v.linkedin_url, '/'))  = norm.u then 'linkedin'
           when lower(rtrim(v.youtube_url, '/'))   = norm.u then 'youtube'
         end as matched_field
  from public.videos v
  cross join norm
  left join public.video_editors e on e.id = v.editor_id
  where norm.u <> ''
    and (lower(rtrim(v.drive_url, '/'))     = norm.u
      or lower(rtrim(v.instagram_url, '/')) = norm.u
      or lower(rtrim(v.linkedin_url, '/'))  = norm.u
      or lower(rtrim(v.youtube_url, '/'))   = norm.u)
  order by v.created_at asc
  limit 1;
$$;

grant execute on function public.find_video_by_url(text) to authenticated;
