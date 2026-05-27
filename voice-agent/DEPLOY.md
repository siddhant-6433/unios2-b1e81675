# voice-agent deploy

Hosted on **Google Cloud Run**.

- Service: `nimt-voice-agent`
- Region: `asia-southeast1`
- Project: `nimt-voice-agent`

Redeploy from the repo root:

```sh
gcloud run deploy nimt-voice-agent --source voice-agent/ --region asia-southeast1
```

The service URL is stored as `VOICE_AGENT_URL` in Supabase function secrets
(referenced by `manual-call`, `voice-call`, etc.). New revisions reuse the
same URL — no client config update needed after a redeploy.
