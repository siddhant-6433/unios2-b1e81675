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

    // Clean up public-schema records first (avoids FK constraint errors)
    await adminClient.from("user_roles").delete().eq("user_id", user_id);
    await adminClient.from("profiles").delete().eq("user_id", user_id);

    // Delete from Supabase Auth
    const { error: deleteError } = await adminClient.auth.admin.deleteUser(user_id);
    if (deleteError) return json({ error: deleteError.message }, 400);

    return json({ success: true });
  } catch (err: any) {
    console.error("[delete-user] Error:", err);
    return json({ error: err.message || "Internal server error" }, 500);
  }
});
