-- fee_notification_campaigns was created with RLS + a policy but no table GRANTs,
-- so every write got "permission denied for table fee_notification_campaigns":
-- the edge fn's service_role insert AND any authenticated read both hit the
-- privilege check before RLS. RLS policies gate rows; GRANTs gate access at all.
grant select, insert, update, delete on public.fee_notification_campaigns to authenticated;
grant all on public.fee_notification_campaigns to service_role;
