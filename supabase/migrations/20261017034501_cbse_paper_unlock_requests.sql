-- Teachers request that a locked marks paper (UT1, UT2, Half Yearly ...) be unlocked, with a reason;
-- a super admin approves (paper unlocked, assessment back to marks entry) or rejects.

create table if not exists public.cbse_unlock_requests (
 id uuid primary key default gen_random_uuid(),
 exam_id uuid not null references public.cbse_exams(id) on delete cascade,
 paper_id uuid not null references public.cbse_papers(id) on delete cascade,
 status text not null default 'pending' check(status in ('pending','approved','rejected')),
 reason text not null check(length(btrim(reason))>0),
 requested_by uuid not null, requested_at timestamptz not null default now(),
 review_remarks text, reviewed_by uuid, reviewed_at timestamptz
);
create unique index if not exists cbse_unlock_requests_one_pending on public.cbse_unlock_requests(paper_id) where status='pending';
create index if not exists cbse_unlock_requests_status on public.cbse_unlock_requests(status,requested_at desc);
alter table public.cbse_unlock_requests enable row level security; -- RPC-only access

create or replace function public.cbse_is_super_admin() returns boolean language sql stable security definer set search_path=public,pg_temp as $$
 select exists(select 1 from user_roles where user_id=cbse_actor() and role::text='super_admin')
$$;

create or replace function public.cbse_request_paper_unlock(_paper_id uuid,_reason text) returns uuid
language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid; p cbse_papers; e cbse_exams; v_id uuid;
begin
 perform cbse_enabled();
 actor:=cbse_actor();
 select * into p from cbse_papers where id=_paper_id;
 if not found then raise exception 'Paper not found'; end if;
 select * into e from cbse_exams where id=p.exam_id;
 if not (p.teacher_user_id=actor and cbse_teacher(e.id,p.subject_id,actor)) and not cbse_academic_role() then raise exception 'You are not assigned to this paper'; end if;
 if p.locked_at is null then raise exception 'This paper is not locked'; end if;
 if e.status not in ('open','class_review','principal_review') then raise exception 'This assessment can no longer be reopened for correction'; end if;
 if btrim(coalesce(_reason,''))='' then raise exception 'Enter the reason for unlocking'; end if;
 insert into cbse_unlock_requests(exam_id,paper_id,reason,requested_by) values(e.id,p.id,btrim(_reason),actor) returning id into v_id;
 insert into cbse_audit(exam_id,action,actor_id,remarks,details) values(e.id,'request_unlock',actor,btrim(_reason),jsonb_build_object('paper_id',p.id,'request_id',v_id));
 return v_id;
exception when unique_violation then raise exception 'An unlock request is already pending for this paper';
end $$;

-- Pending requests for the super-admin queue.
create or replace function public.cbse_unlock_requests_pending() returns jsonb
language plpgsql stable security definer set search_path=public,pg_temp as $$
begin
 perform cbse_enabled();
 if not cbse_is_super_admin() then raise exception 'Only a super admin can review unlock requests'; end if;
 return coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'exam_id',r.exam_id,'exam_name',e.name,'paper_name',p.name,'class_name',c.name,'section',e.section,
   'teacher',coalesce(nullif(btrim(coalesce(pr.display_name,'')),''),pr.email,'Teacher'),'reason',r.reason,'requested_at',r.requested_at) order by r.requested_at)
  from cbse_unlock_requests r join cbse_papers p on p.id=r.paper_id join cbse_exams e on e.id=r.exam_id join courses c on c.id=e.course_id
  left join profiles pr on pr.user_id=r.requested_by where r.status='pending'),'[]'::jsonb);
end $$;

create or replace function public.cbse_review_paper_unlock(_request_id uuid,_decision text,_remarks text default null) returns void
language plpgsql security definer set search_path=public,pg_temp as $$
declare actor uuid; r cbse_unlock_requests; e cbse_exams;
begin
 perform cbse_enabled();
 actor:=cbse_actor();
 if not cbse_is_super_admin() then raise exception 'Only a super admin can review unlock requests'; end if;
 if _decision not in ('approved','rejected') then raise exception 'Choose approve or reject'; end if;
 select * into r from cbse_unlock_requests where id=_request_id for update;
 if not found or r.status<>'pending' then raise exception 'Request not found or already reviewed'; end if;
 select * into e from cbse_exams where id=r.exam_id for update;
 if _decision='approved' then
  if e.status not in ('open','class_review','principal_review') then raise exception 'This assessment is already approved; withdraw it before unlocking'; end if;
  update cbse_papers set locked_at=null where id=r.paper_id;
  update cbse_exams set status='open',version=version+1 where id=e.id;
 end if;
 update cbse_unlock_requests set status=_decision,review_remarks=nullif(btrim(coalesce(_remarks,'')),''),reviewed_by=actor,reviewed_at=now() where id=r.id;
 insert into cbse_audit(exam_id,action,actor_id,remarks,details) values(e.id,'review_unlock',actor,nullif(btrim(coalesce(_remarks,'')),''),jsonb_build_object('paper_id',r.paper_id,'request_id',r.id,'decision',_decision));
end $$;

grant execute on function public.cbse_request_paper_unlock(uuid,text) to authenticated;
grant execute on function public.cbse_unlock_requests_pending() to authenticated;
grant execute on function public.cbse_review_paper_unlock(uuid,text,text) to authenticated;
