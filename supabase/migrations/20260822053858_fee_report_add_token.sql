-- Add the pay-link token to the delivery report so staff can copy/resend the
-- exact same link to an individual student. Return shape changes → drop + recreate.
drop function if exists public.get_fee_notification_report(uuid);

create function public.get_fee_notification_report(p_campaign_id uuid)
returns table (
  student_id      uuid,
  name            text,
  phone           text,
  amount_due      numeric,
  delivery_status text,
  delivered       boolean,
  read            boolean,
  read_at         timestamptz,
  paid            boolean,
  token           text
)
language sql
security definer
set search_path = public
as $$
  select
    pl.student_id,
    s.name,
    s.phone,
    pl.amount as amount_due,
    coalesce(wm.status, case when pl.wa_message_id is null then 'not_sent' else 'sent' end) as delivery_status,
    coalesce(wm.status in ('delivered','read'), false) as delivered,
    coalesce(wm.status = 'read', false) as read,
    wm.read_at,
    (pl.status = 'paid') as paid,
    pl.token
  from public.payment_links pl
  join public.students s on s.id = pl.student_id
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
