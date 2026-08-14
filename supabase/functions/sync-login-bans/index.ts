// Make profiles.login_disabled actually stop somebody signing in.
//
// The flag HR sets is not the gate. The gate is auth.users.banned_until, and only
// the auth admin API can move it — which a Postgres trigger cannot call. So the
// exit trigger marks the profile and this function reconciles the auth layer to
// match, on a schedule.
//
// Reconciling rather than reacting is deliberate. The alternative — trigger fires
// pg_net at an edge function — is the pattern that has already broken twice in this
// project, when _app_config.service_role_key drifted from the edge environment and
// every call 401'd in silence. A reconciler has no such coupling: if a run fails,
// the next one still finds the drift and fixes it. It also repairs writers that
// were never wired up at all, like transfer_counsellor_account, which has always
// set login_disabled without banning anybody.

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// 100 years — effectively permanent. Same constant toggle-user-login uses.
const PERMANENT_BAN = "876000h";

/** The `role` claim of a Supabase JWT, or null if it isn't one. */
function jwtRole(token: string): string | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = payload + "=".repeat((4 - (payload.length % 4)) % 4);
    return JSON.parse(atob(padded))?.role ?? null;
  } catch {
    return null;
  }
}

interface DriftRow {
  user_id: string;
  display_name: string | null;
  should_be_banned: boolean;
  currently_banned: boolean;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const json = (body: object, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);

    // Reconciling is idempotent, but it bans people — so it is not something any
    // signed-in user should be able to fire. The scheduler presents the service
    // key; a human has to be super_admin or hold the HR permission.
    // Accept any valid service-role JWT rather than string-matching the env key:
    // the scheduler reads its key from _app_config, which has drifted out of step
    // with the edge environment before and silently 401'd every cron run.
    const token = req.headers.get("Authorization")?.replace("Bearer ", "") ?? "";
    let allowed = token === serviceKey || jwtRole(token) === "service_role";
    if (!allowed && token) {
      const { data: caller } = await admin.auth.getUser(token);
      const callerId = caller?.user?.id;
      if (callerId) {
        const [{ data: role }, { data: perms }] = await Promise.all([
          admin.rpc("get_user_role", { _user_id: callerId }),
          admin.rpc("get_user_permissions", { _user_id: callerId }),
        ]);
        allowed = role === "super_admin"
          || (Array.isArray(perms) && perms.includes("hr:employees_edit"));
      }
    }
    if (!allowed) return json({ error: "Forbidden" }, 403);

    // Only the rows where the profile and the auth user disagree. Deliberately not
    // auth.admin.listUsers(), which pages at 1000 and has silently skipped the
    // oldest accounts here before.
    const { data, error } = await admin.rpc("login_ban_drift");
    if (error) return json({ error: error.message }, 500);

    const drift = (data ?? []) as DriftRow[];
    const banned: string[] = [];
    const unbanned: string[] = [];
    const failed: { user_id: string; error: string }[] = [];

    for (const row of drift) {
      const { error: banErr } = await admin.auth.admin.updateUserById(row.user_id, {
        ban_duration: row.should_be_banned ? PERMANENT_BAN : "none",
      } as never);

      if (banErr) {
        failed.push({ user_id: row.user_id, error: banErr.message });
        continue;
      }

      if (row.should_be_banned) {
        // A ban alone leaves an existing access token valid until it expires, so
        // somebody already signed in keeps working for up to an hour. Kick them now.
        const { error: revokeErr } = await admin.rpc("admin_revoke_user_sessions", {
          _user_id: row.user_id,
        });
        if (revokeErr) console.error(`[sync-login-bans] revoke failed for ${row.user_id}:`, revokeErr.message);
        banned.push(row.user_id);
      } else {
        unbanned.push(row.user_id);
      }

      await admin.from("user_admin_audit_log").insert({
        target_user_id: row.user_id,
        target_display_name: row.display_name,
        action: row.should_be_banned ? "login_disabled" : "login_enabled",
        details: { source: "sync-login-bans" },
      });
    }

    const summary = {
      checked: drift.length,
      banned: banned.length,
      unbanned: unbanned.length,
      failed: failed.length,
      failures: failed,
    };
    if (drift.length) console.log("[sync-login-bans]", JSON.stringify(summary));
    return json(summary);
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
});
