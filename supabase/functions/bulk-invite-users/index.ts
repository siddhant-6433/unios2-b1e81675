import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const VALID_ROLES = [
  "super_admin", "campus_admin", "principal", "admission_head",
  "counsellor", "accountant", "faculty", "teacher",
  "data_entry", "office_assistant", "hostel_warden", "student", "parent",
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Missing authorization" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const anonKey = Deno.env.get("SUPABASE_PUBLISHABLE_KEY")!;

    // Verify caller is super_admin
    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user: caller } } = await callerClient.auth.getUser();
    if (!caller) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminClient = createClient(supabaseUrl, serviceRoleKey);
    const { data: callerRole } = await adminClient.rpc("get_user_role", { _user_id: caller.id });
    if (callerRole !== "super_admin") {
      return new Response(JSON.stringify({ error: "Forbidden: super_admin only" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { users } = await req.json();

    if (!Array.isArray(users) || users.length === 0) {
      return new Response(JSON.stringify({ error: "No users provided" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (users.length > 100) {
      return new Response(JSON.stringify({ error: "Maximum 100 users per batch" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const results: { email: string; success: boolean; error?: string }[] = [];

    for (const user of users) {
      const { email, display_name, campus, role } = user;

      if (!email || !role) {
        results.push({ email: email || "unknown", success: false, error: "Email and role are required" });
        continue;
      }

      if (!VALID_ROLES.includes(role)) {
        results.push({ email, success: false, error: `Invalid role: ${role}` });
        continue;
      }

      try {
        const { data: newUser, error: inviteError } =
          await adminClient.auth.admin.inviteUserByEmail(email, {
            data: {
              display_name: display_name || email,
              full_name: display_name || email,
            },
          });

        if (inviteError) {
          results.push({ email, success: false, error: inviteError.message });
          continue;
        }

        // Update profile
        if (display_name || campus) {
          await adminClient
            .from("profiles")
            .update({
              ...(display_name && { display_name }),
              ...(campus && { campus }),
            })
            .eq("user_id", newUser.user.id);
        }

        // Assign role
        const { error: roleError } = await adminClient
          .from("user_roles")
          .insert({ user_id: newUser.user.id, role });

        if (roleError) {
          results.push({ email, success: false, error: `Created but role failed: ${roleError.message}` });
          continue;
        }

        results.push({ email, success: true });
      } catch (err: any) {
        results.push({ email, success: false, error: err.message });
      }
    }

    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    return new Response(
      JSON.stringify({ succeeded, failed, results }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
