# UniOs

Student lifecycle software for NIMT / Mirai: admissions, lead follow-up, applicant journeys, payments, WhatsApp, and campus operations.

```sh
npm i
npm run dev
```

The app runs on Vite at port 8080. Production deploys from `main` via Netlify; backend is Supabase (`supabase/migrations`, `supabase/functions`).

Create a database migration with `npm run db:migration:new -- <name>` — do not hand-stamp timestamps.

For Mirai domain branding, template approvals, activation gates and rollback, see the [Mirai rollout guide](docs/mirai-rollout.md). Public activation remains disabled until its acceptance checks pass.

For reviewing, applying and rolling back a lead backlog cleanup, see the [lead cleanup guide](docs/lead-backlog-cleanup.md). Deployment alone does not change the backlog.
