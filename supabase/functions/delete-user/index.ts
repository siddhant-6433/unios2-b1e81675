import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

async function bestEffort(
  label: string,
  operation: PromiseLike<{ error: { message: string } | null }>,
) {
  const { error } = await operation;
  if (error) console.warn(`[delete-user] ${label} failed:`, error.message);
}

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
    console.log("[delete-user] JWT claims.sub:", claims?.sub, "role:", claims?.role);

    if (!claims?.sub) return json({ error: "Invalid token" }, 401);
    if (claims.exp && claims.exp < Date.now() / 1000) return json({ error: "Token expired" }, 401);

    const callerId = claims.sub as string;

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const adminClient = createClient(supabaseUrl, serviceRoleKey);

    // Check caller has super_admin role via SECURITY DEFINER RPC (bypasses table permissions)
    const { data: callerRole, error: roleError } = await adminClient.rpc("get_user_role", { _user_id: callerId });
    console.log("[delete-user] callerId:", callerId, "callerRole:", callerRole, "roleError:", roleError?.message);

    if (callerRole !== "super_admin") {
      return json({ error: "Forbidden: super_admin only" }, 403);
    }

    const { user_id } = await req.json();
    if (!user_id) return json({ error: "user_id is required" }, 400);
    if (user_id === callerId) return json({ error: "You cannot delete your own account." }, 400);

    // Prevent deletion of super_admin users
    const { data: targetRole } = await adminClient.rpc("get_user_role", { _user_id: user_id });
    if (targetRole === "super_admin") {
      return json({ error: "Super Admin accounts cannot be deleted." }, 403);
    }

    const [{ data: targetProf }, { data: callerProf }] = await Promise.all([
      adminClient
        .from("profiles")
        .select("id, display_name")
        .eq("user_id", user_id)
        .maybeSingle(),
      adminClient
        .from("profiles")
        .select("display_name")
        .eq("user_id", callerId)
        .maybeSingle(),
    ]);

    // Revoke access and hide the profile instead of hard-deleting rows. Staff
    // accounts are referenced by leads, attendance, approvals, messages, etc.;
    // deleting auth.users/profiles directly trips FK constraints and can erase
    // useful historical attribution.
    const { error: roleErrorDelete } = await adminClient
      .from("user_roles")
      .delete()
      .eq("user_id", user_id);
    if (roleErrorDelete) return json({ error: roleErrorDelete.message }, 400);

    await Promise.all([
      bestEffort(
        "unlink consultant",
        adminClient.from("consultants").update({ user_id: null }).eq("user_id", user_id),
      ),
      bestEffort(
        "unlink academic partner",
        adminClient.from("academic_partners").update({ user_id: null }).eq("user_id", user_id),
      ),
      bestEffort(
        "unlink publisher",
        adminClient.from("publishers").update({ user_id: null }).eq("user_id", user_id),
      ),
      bestEffort(
        "unlink video editor",
        adminClient.from("video_editors").update({ user_id: null }).eq("user_id", user_id),
      ),
    ]);

    const { error: profileError } = await adminClient
      .from("profiles")
      .update({
        login_disabled: true,
        deleted_at: new Date().toISOString(),
        deleted_by: callerId,
      })
      .eq("user_id", user_id);
    if (profileError) return json({ error: profileError.message }, 400);

    const { error: revokeError } = await adminClient.rpc("admin_revoke_user_sessions", {
      _user_id: user_id,
    });
    if (revokeError) console.warn("[delete-user] session revoke failed:", revokeError.message);

    // Soft-delete Auth user so rows that reference auth.users(id) keep valid
    // foreign keys while the account can no longer authenticate.
    const { error: deleteError } = await adminClient.auth.admin.deleteUser(user_id, true);
    if (deleteError) return json({ error: deleteError.message }, 400);

    await adminClient.from("user_admin_audit_log").insert({
      target_user_id: user_id,
      target_display_name: targetProf?.display_name ?? null,
      action: "user_deleted",
      details: targetProf?.id ? { profile_id: targetProf.id } : null,
      performed_by: callerId,
      performed_by_name: callerProf?.display_name ?? null,
    });

    return json({ success: true, deleted: true });
  } catch (err: any) {
    console.error("[delete-user] Error:", err);
    return json({ error: err.message || "Internal server error" }, 500);
  }
});
