-- Delivery reports for Fee Notification campaigns.
--
-- Each recipient is a payment_links row (fee_campaign_id + student_id). We stamp
-- the WhatsApp message id returned by whatsapp-send onto that row, then join to
-- whatsapp_messages (whose status the Meta webhook advances sent→delivered→read
-- →failed) to report live delivery — alongside whether the student has paid.

alter table public.payment_links
  add column if not exists wa_message_id text;

comment on column public.payment_links.wa_message_id is
  'Meta wamid of the WhatsApp send for this link (fee-notify-bulk). Joins to whatsapp_messages.wa_message_id for delivery status.';

-- Per-recipient report for one campaign. SECURITY DEFINER so staff can read the
-- delivery status across whatsapp_messages (RLS-restricted) without widening it;
-- guarded to the same staff roles that own fee_notification_campaigns.
create or replace function public.get_fee_notification_report(p_campaign_id uuid)
returns table (
  student_id      uuid,
  name            text,
  phone           text,
  amount_due      numeric,
  delivery_status text,
  delivered       boolean,
  read            boolean,
  read_at         timestamptz,
  paid            boolean
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
    (pl.status = 'paid') as paid
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
