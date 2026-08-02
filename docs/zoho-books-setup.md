# Zoho Books sync — setup

Syncs consultant payouts to Zoho Books: a **"Send to Zoho"** button creates the
consultant as a **vendor** (matched by phone), creates a **Bill** for the payout,
and attaches the payout-slip **PDF**. Paying inside UniOs records a **Vendor
Payment** in Zoho; a Zoho **webhook** marks the UniOs payout paid when it's paid
in Zoho (either side works, and it's idempotent).

Data center: **India** (`books.zoho.in`). For another region set
`ZOHO_ACCOUNTS_DOMAIN` / `ZOHO_API_DOMAIN` (see `_shared/zoho.ts`).

## 1. Create a Zoho self-client (one time)

1. Go to <https://api-console.zoho.in/> → **Add Client** → **Self Client** → Create.
2. Copy the **Client ID** and **Client Secret**.
3. **Generate Code** tab → scope:
   `ZohoBooks.contacts.CREATE,ZohoBooks.contacts.READ,ZohoBooks.bills.CREATE,ZohoBooks.bills.READ,ZohoBooks.vendorpayments.CREATE`
   (or `ZohoBooks.fullaccess.all`), duration 10 min, portal = your org → **Create**. Copy the grant **code**.
4. Exchange the code for a **refresh token** (within 10 min):
   ```bash
   curl -s "https://accounts.zoho.in/oauth/v2/token" \
     -d grant_type=authorization_code -d client_id=<CLIENT_ID> \
     -d client_secret=<CLIENT_SECRET> -d code=<CODE>
   ```
   Save the `refresh_token` (it does not expire).
5. **Organization ID**: Zoho Books → Settings → Organizations (or the `organization_id` in the Books URL).

## 2. Set Supabase secrets

```bash
supabase secrets set \
  ZOHO_CLIENT_ID=... ZOHO_CLIENT_SECRET=... ZOHO_REFRESH_TOKEN=... \
  ZOHO_ORG_ID=... ZOHO_WEBHOOK_SECRET=<any-random-string>
```
`ZOHO_ACCOUNTS_DOMAIN` / `ZOHO_API_DOMAIN` are optional (default to the India DC).

## 3. Deploy the functions

```bash
supabase functions deploy zoho-books-sync --use-api
supabase functions deploy zoho-books-webhook --use-api
```

## 4. Configure the Zoho webhook (payment → UniOs)

Zoho Books → **Settings → Automation → Webhooks → New Webhook**:
- Module: **Bill**, event: **Payment recorded** (or bill status → Paid).
- URL:
  ```
  https://<PROJECT_REF>.functions.supabase.co/zoho-books-webhook?secret=<ZOHO_WEBHOOK_SECRET>
  ```
- Method POST, JSON body.

## Notes / limits
- Vendor is matched by the **last 10 digits of the phone**; if a consultant has
  no phone, a new vendor is created each time — set a phone first.
- The slip PDF is generated client-side and attached to the bill.
- `zoho_vendor_id` (consultants) and `zoho_bill_id` / `zoho_payment_id` /
  `zoho_sync_error` (consultant_payouts) store the sync state; the payout row
  shows a **Zoho <bill#>** badge once synced.
- **This is a first version and has not been tested against a live Zoho org.**
  Run one payout end-to-end and check the Zoho payload shapes (contacts search,
  bill/vendorpayment fields, webhook body) before relying on it. The same
  `zoho-books-sync` helpers are structured to later back an approved-expense →
  bill → paid flow.
