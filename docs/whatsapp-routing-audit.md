# WhatsApp Routing Audit

Outbound WhatsApp sends should not all use the same Meta phone number. Spam-prone or high-volume sends can damage the quality rating of operational numbers used for OTP, call follow-ups, and visit confirmations.

## Phone Number Routes

Configure these Supabase Edge Function secrets. Each route falls back to `WHATSAPP_API_TOKEN` and `WHATSAPP_PHONE_NUMBER_ID` if the route-specific secret is not set.

| Route | Secrets | Current send paths |
| --- | --- | --- |
| OTP | `WHATSAPP_OTP_API_TOKEN`, `WHATSAPP_OTP_PHONE_NUMBER_ID` | `whatsapp-otp` login OTPs |
| Call based | `WHATSAPP_CALL_API_TOKEN`, `WHATSAPP_CALL_PHONE_NUMBER_ID` | `missed_call`, `callback_scheduled`, `ai_call_course_info`, `ai_call_post_summary`, `ai_missed_call_followup`, `post_call_feedback`, `counsellor_call_lead` |
| Visit confirmations | `WHATSAPP_VISIT_API_TOKEN`, `WHATSAPP_VISIT_PHONE_NUMBER_ID` | `visit_confirmation`, `visit_reminder_24hr`, `counsellor_visit_confirmation`, `post_visit_feedback`, direct `visit-reminders` cron |
| Bulk | `WHATSAPP_BULK_API_TOKEN`, `WHATSAPP_BULK_PHONE_NUMBER_ID` | `whatsapp-campaign-send` |
| Replies | `WHATSAPP_REPLY_API_TOKEN`, `WHATSAPP_REPLY_PHONE_NUMBER_ID` | Manual inbox replies when no inbound business number is available, DNC acknowledgements |
| Default | `WHATSAPP_API_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` | Lead/application/payment/student lifecycle templates and fallback sends |

Manual inbox replies and webhook auto-replies now prefer the `business_phone_number_id` from the inbound conversation when it matches one of the configured route numbers. This keeps a thread on the same Meta number instead of leaking replies through the default number.

## Spam-Risk Notes

- Bulk campaigns are the highest risk path and now use the bulk route.
- Call-based AI follow-ups were previously sharing the default number; they now use the call route.
- Visit reminders and confirmations now use the visit route.
- OTP now has a dedicated route so login reliability is isolated from marketing quality issues.
- `whatsapp_messages.business_phone_number_id` is populated for the updated outbound paths, making it possible to group sent/failed messages by Meta number.

Useful audit query:

```sql
select
  business_phone_number_id,
  template_key,
  status,
  count(*) as messages
from whatsapp_messages
where direction = 'outbound'
  and created_at >= now() - interval '14 days'
group by 1, 2, 3
order by messages desc;
```

Failed-message detail query:

```sql
select
  created_at,
  business_phone_number_id,
  template_key,
  phone,
  status_error
from whatsapp_messages
where direction = 'outbound'
  and status = 'failed'
  and created_at >= now() - interval '14 days'
order by created_at desc;
```
