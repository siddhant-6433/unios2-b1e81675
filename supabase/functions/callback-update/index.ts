/**
 * Callback Lead Update
 * Updates a lead's name and course after the initial callback request.
 * Auth: Supabase anon key via apikey header.
 * POST body: { lead_id, name?, course_name? }
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Auth: accept anon key
    const anonKeyHeader = req.headers.get("apikey");
    const expectedAnon = Deno.env.get("SUPABASE_ANON_KEY");
    if (!expectedAnon || anonKeyHeader !== expectedAnon) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const { lead_id, name, course_name } = body;

    if (!lead_id) {
      return new Response(JSON.stringify({ error: "lead_id is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    // Build update payload
    const update: Record<string, any> = {};
    if (name && name !== "Callback Request") update.name = name.trim().slice(0, 200);

    // Resolve course_id from course_name
    if (course_name) {
      // Try exact match first, then partial
      let course = null;
      const { data: exact } = await supabase
        .from("courses")
        .select("id, name")
        .eq("name", course_name)
        .limit(1)
        .maybeSingle();

      if (exact) {
        course = exact;
      } else {
        const { data: partial } = await supabase
          .from("courses")
          .select("id, name")
          .ilike("name", `%${course_name}%`)
          .limit(1)
          .maybeSingle();
        course = partial;
      }

      console.log(`Course lookup: "${course_name}" → ${course ? `${course.name} (${course.id})` : "NOT FOUND"}`);

      if (course) {
        update.course_id = course.id;
      }
      update.notes = `Callback request — Interested in: ${course_name}`;
    }

    if (Object.keys(update).length === 0) {
      return new Response(JSON.stringify({ status: "nothing_to_update" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`Updating lead ${lead_id} with:`, JSON.stringify(update));

    const { data: updated, error } = await supabase
      .from("leads")
      .update(update)
      .eq("id", lead_id)
      .select("id, name, course_id, notes")
      .single();

    if (error) {
      console.error("Update error:", error);
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`Updated lead:`, JSON.stringify(updated));

    // Log activity
    await supabase.from("lead_activities").insert({
      lead_id,
      type: "lead_updated",
      description: `Lead updated via website callback form${name ? ` — Name: ${name}` : ""}${course_name ? `, Course: ${course_name}` : ""}`,
    });

    return new Response(JSON.stringify({ status: "updated", lead: updated }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    console.error("Unhandled error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
