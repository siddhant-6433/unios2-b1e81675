/**
 * Service-role caller check for cron / trigger-invoked edge functions.
 *
 * pg_cron and pg_net callers read their bearer from `public._app_config`
 * (`service_role_key`), while edge functions compare against the
 * `SUPABASE_SERVICE_ROLE_KEY` the runtime injects. Those two drifted when the
 * project moved to the new `sb_secret_…` key format: the gateway accepted the
 * new key (verify_jwt=false), our string compare rejected it, and every
 * scheduled job 403'd silently for weeks. Accept either value so a key-format
 * rotation can never silently disable the crons again.
 */

// Loose typing so both esm.sh and npm supabase-js clients work.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AdminClient = any;

function bearerOf(req: Request): string {
  return (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "").trim();
}

export async function isServiceCaller(req: Request, admin: AdminClient): Promise<boolean> {
  const bearer = bearerOf(req);
  // Never treat an absent/short header as a service caller.
  if (bearer.length < 20) return false;

  const envKey = (Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "").trim();
  if (envKey && bearer === envKey) return true;

  // Fall back to whatever the DB hands to pg_net — this is the value crons
  // actually send. Reading it needs the admin client, which already holds the
  // env key, so this cannot be used to escalate.
  const { data, error } = await admin
    .from("_app_config")
    .select("value")
    .eq("key", "service_role_key")
    .maybeSingle();
  if (error) {
    console.error("[service-auth] _app_config read failed:", error.message);
    return false;
  }
  const cfgKey = String(data?.value || "").trim();
  if (cfgKey && bearer === cfgKey) {
    if (envKey && cfgKey !== envKey) {
      console.warn("[service-auth] _app_config.service_role_key differs from env SUPABASE_SERVICE_ROLE_KEY — accepted, but re-sync it.");
    }
    return true;
  }
  return false;
}
