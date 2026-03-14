

## Update WhatsApp API Credentials

### What needs to happen
Two backend secrets need to be updated with your correct credentials:

1. **WHATSAPP_API_TOKEN** — Your permanent System User access token from Meta Business Manager
2. **WHATSAPP_PHONE_NUMBER_ID** — The numeric Phone Number ID from WhatsApp Manager

### Implementation steps
1. Use the `add_secret` tool to prompt you to securely enter the new **WHATSAPP_PHONE_NUMBER_ID** value
2. Use the `add_secret` tool to prompt you to securely enter the new **WHATSAPP_API_TOKEN** value
3. Test the WhatsApp OTP flow by calling the `whatsapp-otp` edge function to verify the credentials work

### Where to find these values
- **Phone Number ID**: Meta Business Manager → WhatsApp Manager → Phone Numbers → copy the numeric ID (not the phone number itself)
- **API Token**: Meta Business Manager → System Users → select your System User → Generate Token with `whatsapp_business_messaging` permission

No code changes are required — only secret values need updating.

