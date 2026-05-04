import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function decodeJwt(token: string): Record<string, any> | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
    const padded = payload + "=".repeat((4 - (payload.length % 4)) % 4);
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

// 100 years — effectively permanent.
const PERMANENT_BAN = "876000h";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const json = (body: object, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) return json({ error: "Missing authorization" }, 401);

    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : authHeader;
    const claims = decodeJwt(token);
    if (!claims?.sub) return json({ error: "Invalid token" }, 401);
    if (claims.exp && claims.exp < Date.now() / 1000) return json({ error: "Token expired" }, 401);

    const callerId = claims.sub as string;

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    // Caller must be super_admin.
    const { data: callerRole } = await adminClient.rpc("get_user_role", { _user_id: callerId });
    if (callerRole !== "super_admin") {
      return json({ error: "Forbidden: super_admin only" }, 403);
    }

    const { user_id, disabled } = await req.json();
    if (!user_id || typeof user_id !== "string") {
      return json({ error: "user_id is required" }, 400);
    }
    if (typeof disabled !== "boolean") {
      return json({ error: "disabled (boolean) is required" }, 400);
    }
    if (user_id === callerId) {
      return json({ error: "You cannot disable your own login." }, 400);
    }

    // Refuse to disable a super_admin (matches delete-user guard).
    if (disabled) {
      const { data: targetRole } = await adminClient.rpc("get_user_role", { _user_id: user_id });
      if (targetRole === "super_admin") {
        return json({ error: "Super Admin accounts cannot be disabled." }, 403);
      }
    }

    // Resolve display names for the audit log.
    const [{ data: targetProf }, { data: callerProf }] = await Promise.all([
      adminClient.from("profiles").select("display_name").eq("user_id", user_id).maybeSingle(),
      adminClient.from("profiles").select("display_name").eq("user_id", callerId).maybeSingle(),
    ]);

    // ── Apply the auth-layer change ──
    // ban_duration "none" clears banned_until; any duration string sets it forward.
    const { error: banError } = await adminClient.auth.admin.updateUserById(user_id, {
      ban_duration: disabled ? PERMANENT_BAN : "none",
    } as any);
    if (banError) return json({ error: banError.message }, 400);

    // Mirror to profiles for UI queries (filter, badges).
    const { error: profError } = await adminClient
      .from("profiles")
      .update({ login_disabled: disabled })
      .eq("user_id", user_id);
    if (profError) {
      console.error("[toggle-user-login] profile mirror failed:", profError.message);
      // Don't fail the request — auth-layer change already applied.
    }

    // Immediate kick-out: revoke active sessions + refresh tokens.
    if (disabled) {
      const { error: revokeError } = await adminClient.rpc("admin_revoke_user_sessions", {
        _user_id: user_id,
      });
      if (revokeError) {
        console.error("[toggle-user-login] session revoke failed:", revokeError.message);
        // Auth ban is in place; user will be locked out at next token refresh
        // even if direct session revoke didn't work.
      }
    }

    // Audit log.
    await adminClient.from("user_admin_audit_log").insert({
      target_user_id: user_id,
      target_display_name: targetProf?.display_name ?? null,
      action: disabled ? "login_disabled" : "login_enabled",
      details: null,
      performed_by: callerId,
      performed_by_name: callerProf?.display_name ?? null,
    });

    return json({ success: true, disabled });
  } catch (err: any) {
    console.error("[toggle-user-login] Error:", err);
    return json({ error: err.message || "Internal server error" }, 500);
  }
});
