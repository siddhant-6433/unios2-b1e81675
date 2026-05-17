# WhatsApp Sign-In

## User Flow

1. The login page shows `Continue with WhatsApp` as the primary action.
2. The browser calls `whatsapp-otp` with `action: "start_sign_in"`.
3. The edge function creates a 5-minute `whatsapp_login_intents` row and returns:
   - `intent_id`
   - `client_secret`
   - `deeplink_url`
   - `expires_at`
4. The browser opens the returned WhatsApp deeplink.
5. The user sends the prefilled message containing `UNIOS-XXXXXXXX`.
6. `whatsapp-webhook` receives the inbound message, verifies the pending code, and marks the intent `verified` with the sender phone.
7. The browser polls `whatsapp-otp` with `action: "status_sign_in"`.
8. The edge function resolves the sender phone using the same profile/student/parent logic as WhatsApp OTP, mints a Supabase session, and marks the intent `consumed`.

## Edge Function Contract

### Start

`POST /functions/v1/whatsapp-otp`

```json
{ "action": "start_sign_in" }
```

Response:

```json
{
  "success": true,
  "intent_id": "uuid",
  "client_secret": "browser-only-secret",
  "code": "ABCDEFGH",
  "expires_at": "2026-05-17T12:00:00.000Z",
  "deeplink_url": "https://wa.me/91..."
}
```

### Poll

`POST /functions/v1/whatsapp-otp`

```json
{
  "action": "status_sign_in",
  "intent_id": "uuid",
  "client_secret": "browser-only-secret"
}
```

Pending response:

```json
{ "success": true, "status": "pending" }
```

Verified response:

```json
{
  "success": true,
  "status": "verified",
  "token": {
    "access_token": "...",
    "refresh_token": "..."
  },
  "role": "student"
}
```

Terminal failures return `status: "expired"` or `status: "failed"` with `error`.

## Required Secrets

- `WHATSAPP_API_TOKEN`
- `WHATSAPP_PHONE_NUMBER_ID`
- `WHATSAPP_SIGN_IN_PHONE` or `WHATSAPP_BUSINESS_PHONE`

`WHATSAPP_SIGN_IN_PHONE` must be the actual business WhatsApp number in digits/E.164 format without spaces. It is different from Meta's phone-number ID.

## Security Notes

- The WhatsApp message contains only a short code.
- The browser must also know `client_secret`; a WhatsApp sender alone cannot poll or claim the login.
- Intents expire after 5 minutes and are marked `consumed` after one successful session mint.
- The webhook skips normal inbox/AI processing for `UNIOS-XXXXXXXX` messages.
- This flow is still vulnerable to social engineering if a user sends a login message they did not initiate, so the prefilled message explicitly says to send it only for the current device.
