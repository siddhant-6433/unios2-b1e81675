

## Update WHATSAPP_PHONE_NUMBER_ID Secret

**What**: Update the `WHATSAPP_PHONE_NUMBER_ID` runtime secret with a new value.

**How**: Use the `add_secret` tool to prompt you for the new Phone Number ID value. This will overwrite the existing secret in the backend configuration.

The edge function `whatsapp-otp` will automatically pick up the new value on the next invocation.

