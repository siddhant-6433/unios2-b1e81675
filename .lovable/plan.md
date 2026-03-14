
Goal: resolve the persistent “Failed to send OTP” issue on `/apply/nimt` and make the WhatsApp failure reason visible/actionable.

What I found:
- Backend logs still show Meta error `(#200) You do not have the necessary permissions...`.
- Secrets exist (`WHATSAPP_API_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_OTP_TEMPLATE`), but secret updates may not be active until function redeploy.
- `ApplyPortal` currently hides the detailed backend error and only shows generic “Failed to send OTP”.
- `ApplyPortal` OTP verify logic expects `verifyData.verified`, but the function returns `success` + session token; this can break verification even after send is fixed.

Implementation plan:
1. Redeploy `whatsapp-otp` backend function first
- Force pickup of latest runtime secrets.
- Immediately retest send flow after redeploy.

2. Improve backend diagnostics (safe, no secret leakage)
- Add startup/request logs for secret presence only (`true/false`), template name, and phone-id format sanity.
- Keep current security posture (no actual token/secret values in logs).
- Expand WhatsApp error response payload with `code`, `message`, and `fbtrace_id` (already partially present) so frontend can show meaningful guidance.

3. Fix `/apply/nimt` error handling
- Update `ApplyPortal` send/verify handlers to parse function error body (like `Login.tsx` already does).
- Show specific backend message (e.g., permission denied) instead of generic toast.

4. Fix OTP verify contract mismatch in `/apply/nimt`
- Accept either `verifyData.success === true` or `verifyData.verified === true` for compatibility.
- Optionally align backend verify response to include `verified: true` in addition to `success: true` to avoid future client mismatches.

5. Validation checklist
- Backend function call (`action: send`) returns either:
  - `200 { success: true }`, or
  - `403` with explicit permission detail (not generic failure).
- `/apply/nimt` displays the exact failure reason from backend.
- `/apply/nimt` verify flow no longer fails due to `verified` vs `success` mismatch.
- `/login` WhatsApp OTP flow still works after response alignment.

If error `(#200)` persists after redeploy:
- The token/asset binding is still external-permission side, not app logic. Next step is token regeneration after permissions are assigned (same business, same WABA, same phone number asset), then retest with the improved diagnostics.
