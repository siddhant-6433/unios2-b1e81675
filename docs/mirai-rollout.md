# Mirai Uni rollout

This release prepares the existing Uni deployment to serve `uni.miraischool.in` with Mirai's existing logo and green theme after activation. `/apply` will open Mirai admissions. Accounts, role redirects, campus access, document ownership, database and authentication providers are shared; browser sessions remain separate per hostname. NIMT/Beacon keep their existing routes and sender configuration.

## Live preparation status (updated 5 October 2026)

- The owner added the Netlify alias and Route 53 record on 4 October 2026. Both `uni.nimt.ac.in` and `uni.miraischool.in` publicly point to `unios.netlify.app`; Cloudflare and Google DNS confirm the Mirai CNAME. TLS verification succeeds, with `uni.miraischool.in` explicitly present on the certificate (expires 2 January 2027). `/`, `/apply`, and `/reset-password` return HTTP 200, and live browser navigation stays on Mirai. The existing production build still shows NIMT login branding and the old Mirai admissions logo; the new branding has not been deployed. Hosting account access remains with the owner.
- Supabase project is **UniOs**, `deylhigsisuexszsmypq`. Its primary auth site URL remains `https://uni.nimt.ac.in`. Mirai's root and `https://uni.miraischool.in/**` were added to the auth redirect allowlist. Passkeys are enabled in the project. On 5 October the owner confirmed the rollout guide’s real-device Mirai sign-in/email callback and payment-provider domain checks were completed; this is owner-reported acceptance, separate from the repository’s automated checks.
- Active Mirai Meta channel: phone **+91 92205 22282**, phone-number ID `1110238142172240`, WABA `34722980423984295`. The registry and template API are verified. On 5 October a dedicated-token Graph check confirmed this WABA’s business verification is `verified`, account review is `APPROVED`, and this exact Cloud API sender is `CONNECTED`. Its phone-code verification field reports `NOT_VERIFIED`; that field is recorded separately from registration and actual delivery evidence.
- All **20** new English lifecycle templates were submitted to that WABA using a fictional sample PDF for document approval. Three templates initially rejected for `INCORRECT_CATEGORY` (`mirai_apply_portal_login_v1`, `mirai_student_admitted_welcome_v1`, and `mirai_student_portal_invite_v1`) were revised and resubmitted as `UTILITY` on 4 October 2026, retaining their IDs, names, parameter order and buttons. Copy now describes the existing application, confirmed admission and account-creation records rather than generic welcomes. Meta accepted all three edits for review; approval is still required before launch. The latest check shows application access and student invitations approved in `UTILITY`; admission confirmation remains pending, with the prior rejection reasons cleared. Meta refused an in-place category change for the approved `MARKETING` completion reminder. A replacement `mirai_application_completion_reminder_v2` was submitted as `UTILITY` on 5 October with a specific request for missing applicant information. The replacement is now approved in `UTILITY`; 19 of the 20 active templates are ready, with only admission confirmation still pending. Its event key and two parameters remain unchanged; the old `v1` name routes through the new reviewed definition and is retained in Meta and hidden from the staff lifecycle picker. Sends are restricted to saved drafts genuinely missing required applicant name, date of birth or gender; the utility copy must not be used as a generic re-engagement message. Rejection reasons sync to the existing template manager. Run `check` below for current status.
- Controlled staff delivery on 5 October: all **19 approved Utility templates** were sent once to the owner-authorised staff number ending **3193**, using fictional `TEST-MIRAI-727` records and a newly generated, clearly marked staff-test PDF. Meta delivery receipts confirm **19/19 delivered**, with the exact Mirai sender ID and no failures. Recipient override attempts were rejected, the pending admission-confirmation template was blocked, and a duplicate request was skipped without resending. Tests used an isolated, service-authenticated, nonce-protected, expiring endpoint and the release’s strict sender helper; public rollout flags remained off. The temporary endpoint was removed afterward. Visual confirmation of sender, PDF and buttons on the staff device is still requested; delivery receipts do not establish complete applicant workflow acceptance.
- Only the `whatsapp-templates` administrative endpoint was deployed, to support authenticated template submission/sync. The app, business edge functions and student-link migration have **not** been deployed. No customer WhatsApp messages were sent, no payment was initiated, and no rollout gate was enabled.

## Gates (default off)

| Location | Setting | Purpose |
| --- | --- | --- |
| Frontend build | `VITE_MIRAI_ROLLOUT_ENABLED=true` | Exposes the Mirai app rather than its holding page; permits canonical token redirects when the server gate agrees. |
| Supabase edge-function secret | `MIRAI_ROLLOUT_ENABLED=true` | Generates new Mirai application/payment URLs and selects Mirai lifecycle templates. |
| Existing `_app_config` table | key `mirai_rollout_enabled`, value `true` | Generates Mirai student invitation URLs in existing RPCs. The additive migration initializes this to `false`. |

Optional edge-function setting `MIRAI_APPLY_PORTAL_BASE` defaults to `https://uni.miraischool.in/apply`. Existing `APPLY_PORTAL_BASE`, `CRM_BASE`, `PUBLIC_APP_URL` and `student_portal_base` remain unchanged for other institutions. Do not set these shared bases to Mirai.

The new student-link migration was generated with `npm run db:migration:new -- mirai_student_portal_links`. It retains the existing cashier, super-admin and scoped academic-partner authorization, token expiry and generate/send separation. It adds the saved student ID to the existing send request. Apply it through the project's normal migration deployment process; do not independently apply unrelated pending migrations.

## Templates and sender checks

```sh
# Review copy, parameter order and URL buttons without credentials or messages.
deno run --no-lock --allow-env --allow-net scripts/mirai-templates.ts preview

# Require SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY from the secret manager.
# If the injected edge credential differs from the REST key, set the existing
# trusted service/automation credential as SUPABASE_AUTOMATION_KEY as well.
# An existing CRON_SECRET is also supported. Never commit credentials.
deno run --no-lock --allow-env --allow-net scripts/mirai-templates.ts check

# Resubmit only the allowlisted rejected Mirai templates using the reviewed
# catalogue copy; retain their IDs and require membership in Mirai's WABA.
deno run --no-lock --allow-env --allow-net scripts/mirai-templates.ts resubmit

# Idempotent submission only; already submitted names are skipped.
# DOCUMENT templates require MIRAI_TEMPLATE_DOCUMENT_HANDLE from the existing
# template-media upload workflow, explicitly using Mirai's WABA.
deno run --no-lock --allow-env --allow-net scripts/mirai-templates.ts submit
```

`check` syncs through the existing workflow, verifies the exact active sender, and exits nonzero unless every catalogue template is approved with the reviewed English body, parameter count, document header and URL button. It never activates rollout and requires the actual approved category to remain `UTILITY`. `resubmit` edits only the allowlisted rejected templates in place, uses Mirai's own token without fallback, and skips already-pending/approved matching copy. It never deletes templates or changes their names. `submit` skips rejected names as well as pending/approved names; it does not silently replace them or bypass Meta review. Review rejected categories in WhatsApp Manager, preserve parameter/media/button contracts, and keep the reviewed catalogue in sync with any approved copy changes. Catalogue: `supabase/functions/_shared/mirai-templates.ts`.

New names are `mirai_<event-key>_v1` (completion reminder uses `v2` after Meta recategorization): application login, applicant welcome, completion reminder, submission, approval, rejection, application-fee receipt, offer issuance/acceptance, token-fee reminder, admission-payment nudge, pre-admission balance, payment request, payment receipts (text/PDF), document request/rejection, admission welcomes and student invitation. Existing internal aliases `application_received` and `app_fee_receipt_pdf` retain their parameter contracts.

Completion reminders and document requests appear in the existing staff template picker after approval. Staff supply the application ID or requested document list. No reminder schedule was added. Existing automation settings, deduplication and opt-outs remain in place; authentication OTP templates are unchanged.

Saved lead/application/student ownership determines the catalogue and sender. Hostnames and recipient phone numbers do not determine ownership. The shared Avantika campus is never enough to classify a college application as Mirai. Mirai sends require their exact active phone-number ID and the template's matching WABA. Missing approval, ownership, parameters, actual generated PDFs or sender configuration produces a failed message/activity visible to staff. Meta sender-registration errors cannot trigger cross-WABA recovery. Approval sample PDFs are never used as admissions-message attachments.

## Hosting and provider preparation

1. In the Netlify account currently serving `uni.nimt.ac.in`, verify its project/deployment identity, then add `uni.miraischool.in` to the **same** production site. Retain the NIMT primary hostname. Follow [Netlify domain aliases](https://docs.netlify.com/manage/domains/configure-domains/add-a-domain-alias/).
2. In AWS Route 53 → Hosted zones → the **public** `miraischool.in` zone, confirm its NS record matches `ns-503.awsdns-62.com`, `ns-546.awsdns-04.net`, `ns-1113.awsdns-11.org`, and `ns-1607.awsdns-08.co.uk`. Then create a record: name `uni`, type **CNAME**, value `unios.netlify.app`, TTL **300**, routing **Simple**, Alias **off**. Confirm Netlify’s Pending DNS verification instructions show that same target before saving. Keep existing apex/nameserver records. Follow [AWS record creation](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/resource-record-sets-creating.html) and [Netlify subdomain DNS](https://docs.netlify.com/manage/domains/configure-domains/configure-external-dns/). In Netlify’s HTTPS settings, verify DNS and provision/renew the certificate so it covers the new hostname.
3. Confirm an HTTP request to the Mirai alias is not forcibly redirected to NIMT by Netlify domain rules. The repository already rewrites SPA routes to `/index.html`; refresh `/apply`, `/reset-password`, `/student`, `/parent` and `/pay/<test-token>` on the new alias.
4. Verify [Supabase redirects](https://supabase.com/docs/guides/auth/redirect-urls), email recovery callbacks and Google sign-in on Mirai while retaining existing callbacks. Perform passkey registration and authentication on a real device; credentials enrolled on the NIMT relying-party domain may need separate enrollment. WhatsApp OTP and username/password remain available.
5. Verify payment-provider requirements in the live Razorpay/ICICI merchant configuration. The existing ICICI `ICICI_RETURN_URLS`/`ICICI_RETURN_URL` selection and return-page protocol are unchanged; add an approved Mirai return endpoint only if required by the merchant setup. Keep existing endpoints. No provider credentials or merchant changes were made here.
6. Confirm Mirai analytics events on `/apply` use the existing Mirai GTM container `GTM-WL5MTC3D` and Meta pixel `1461957365199748`, including route transitions and consent behavior.

## Controlled acceptance and activation

Before public activation, all templates must pass `check`. Use a staging/isolated test deployment with gates enabled and a staff-controlled WhatsApp recipient supplied by the owner. Do not send to a real applicant to establish readiness.

Record results for:

- Both hostnames: login, existing role redirects, password reset/email callbacks, logout, employee/sidebar navigation, student and parent shells; desktop/mobile layouts and portal theme cleanup.
- Fresh Mirai application; saved application; expired/invalid token; old NIMT-hosted Mirai token; Mirai-hosted NIMT/Beacon token; offer URL with view/query/hash preserved; Avantika B.Ed regression.
- Submission and uploaded/generated documents; offer issuance/acceptance; application fee and token/admission payments; provider return and settlement; institution-branded receipts; staff-generated and automatic student invitations (including imported students without leads).
- Each lifecycle message's parameters, media and buttons. Verify the sender shown on the staff phone. Re-run with a pending template and disabled/missing sender: confirm failed staff-visible records and no other-WABA send/retry. Check opt-outs and existing automation switches.

Local validation covers brand/routing/theme gates, desktop/mobile public pages with mocked responses, executable student-link SQL (including permissions and imported-student ownership), the real WhatsApp handler with mocked Supabase/Meta APIs, strict sender/no-retry regressions, existing access guardrails and production build. Live public-page checks now establish DNS, TLS and deep-link refreshes on the new domain. They do not establish payment, upload, signed-in role or passkey acceptance for the new release. The frontend TypeScript check has the same 572 diagnostic lines as the unchanged baseline, with no added diagnostics. Broader Deno checks of unchanged ICICI/Razorpay entrypoints expose 53 existing errors (including missing ICICI helper names); these need resolution before claiming a fully passing provider check. All directly changed edge entrypoints and the shared settlement tests pass.

After the deployment, DNS/TLS, provider checks, all approvals and controlled acceptance pass, activate the frontend build flag, edge secret and database key together in a coordinated release. Deploy these changed business edge functions: `generate-apply-link`, `redeem-apply-link`, `notify-event`, `create-payment-link`, `whatsapp-send`, and shared-settlement consumers `icici-payment`, `razorpay-payment`, `easebuzz-payment`, `easebuzz-webhook`, `pay-link`, `payment-link-reconcile-cron` (they import the changed shared settlement code). Recheck template contracts immediately before enabling. Keep the existing database, auth site URL and role policies.

Rollback: set the edge and database gates to `false`, rebuild with the frontend flag disabled and retain both domain/auth entries. Existing tokens/accounts/documents are preserved. Old Mirai links keep working through the existing Uni portal until a later coordinated activation.
