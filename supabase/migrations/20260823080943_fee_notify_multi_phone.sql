-- Widen fee_notification_report to return all available phone numbers per
-- student (student, father, mother, guardian + lead phones) so the frontend
-- can offer a phone picker for resend (wa.me link or WA API).
--
-- Also adds sent_to_phone on payment_links to track which number was used.

alter table public.payment_links
  add column if not exists sent_to_phone text;

comment on column public.payment_links.sent_to_phone is
  'The phone number the WA notification was actually sent to (may differ from students.phone if parent/guardian was used).';

-- Recreate the report function with all phones + sent_to_phone
drop function if exists public.get_fee_notification_report(uuid);

create function public.get_fee_notification_report(p_campaign_id uuid)
returns table (
  student_id         uuid,
  name               text,
  phone              text,
  whatsapp_no        text,
  father_phone       text,
  father_whatsapp    text,
  mother_phone       text,
  mother_whatsapp    text,
  guardian_phone     text,
  lead_phone         text,
  lead_guardian_phone text,
  sent_to_phone      text,
  amount_due         numeric,
  delivery_status    text,
  delivered          boolean,
  read               boolean,
  read_at            timestamptz,
  paid               boolean,
  token              text
)
language sql
security definer
set search_path = public
as $$
  select
    pl.student_id,
    s.name,
    s.phone,
    s.whatsapp_no,
    s.father_phone,
    s.father_whatsapp,
    s.mother_phone,
    s.mother_whatsapp,
    s.guardian_phone,
    l.phone as lead_phone,
    l.guardian_phone as lead_guardian_phone,
    pl.sent_to_phone,
    pl.amount as amount_due,
    coalesce(wm.status, case when pl.wa_message_id is null then 'not_sent' else 'sent' end) as delivery_status,
    coalesce(wm.status in ('delivered','read'), false) as delivered,
    coalesce(wm.status = 'read', false) as read,
    wm.read_at,
    (pl.status = 'paid') as paid,
    pl.token
  from public.payment_links pl
  join public.students s on s.id = pl.student_id
  left join public.leads l on l.id = s.lead_id
  left join public.whatsapp_messages wm on wm.wa_message_id = pl.wa_message_id
  where pl.fee_campaign_id = p_campaign_id
    and (
      has_role(auth.uid(), 'super_admin'::app_role) or has_role(auth.uid(), 'campus_admin'::app_role)
      or has_role(auth.uid(), 'admission_head'::app_role) or has_role(auth.uid(), 'accountant'::app_role)
      or has_role(auth.uid(), 'counsellor'::app_role)
    )
  order by
    case coalesce(wm.status, case when pl.wa_message_id is null then 'not_sent' else 'sent' end)
      when 'failed' then 0 when 'not_sent' then 1 when 'sent' then 2
      when 'delivered' then 3 when 'read' then 4 else 5 end,
    s.name;
$$;

grant execute on function public.get_fee_notification_report(uuid) to authenticated;

