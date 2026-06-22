import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const PAID_DELETE_CONFIRMATION = "CONFIRM";

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

function json(body: object, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function storagePathFromPublicUrl(url: string | null | undefined, bucket: string): string | null {
  if (!url) return null;
  const marker = `/object/public/${bucket}/`;
  const idx = url.indexOf(marker);
  if (idx === -1) return null;
  return decodeURIComponent(url.slice(idx + marker.length));
}

async function removeListedFiles(
  adminClient: ReturnType<typeof createClient>,
  bucket: string,
  prefix: string,
): Promise<number> {
  const { data, error } = await adminClient.storage.from(bucket).list(prefix, {
    limit: 1000,
    sortBy: { column: "name", order: "asc" },
  });
  if (error) throw new Error(error.message);

  const paths = (data || [])
    .filter((file) => file.name && !file.name.endsWith("/"))
    .map((file) => `${prefix}/${file.name}`);

  if (!paths.length) return 0;

  const { error: removeError } = await adminClient.storage.from(bucket).remove(paths);
  if (removeError) throw new Error(removeError.message);

  return paths.length;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

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

    const { data: callerRole } = await adminClient.rpc("get_user_role", { _user_id: callerId });
    if (callerRole !== "super_admin") {
      return json({ error: "Forbidden: super_admin only" }, 403);
    }

    const { application_row_id, paid_delete_confirmation } = await req.json();
    if (!application_row_id || typeof application_row_id !== "string") {
      return json({ error: "application_row_id is required" }, 400);
    }

    const { data: app, error: appError } = await adminClient
      .from("applications")
      .select("id, application_id, payment_status, form_pdf_url, fee_receipt_url")
      .eq("id", application_row_id)
      .maybeSingle();

    if (appError) return json({ error: appError.message }, 500);
    if (!app) return json({ error: "Application not found" }, 404);
    if (app.payment_status === "paid" && paid_delete_confirmation !== PAID_DELETE_CONFIRMATION) {
      return json({ error: `Type ${PAID_DELETE_CONFIRMATION} to delete a paid application.` }, 403);
    }

    const bucket = "application-documents";
    const prefixes = [...new Set([
      app.application_id,
      String(app.application_id).toUpperCase(),
      String(app.application_id).toLowerCase(),
    ])];

    let deletedStorageFiles = 0;
    for (const prefix of prefixes) {
      deletedStorageFiles += await removeListedFiles(adminClient, bucket, prefix);
    }

    const explicitPaths = [...new Set([
      storagePathFromPublicUrl(app.form_pdf_url, bucket),
      storagePathFromPublicUrl(app.fee_receipt_url, bucket),
      `applications/${app.application_id}.pdf`,
      `applications/${app.application_id}-fee-receipt.pdf`,
    ].filter(Boolean) as string[])];

    if (explicitPaths.length > 0) {
      const { error: removeError } = await adminClient.storage.from(bucket).remove(explicitPaths);
      if (removeError) return json({ error: removeError.message }, 500);
    }

    const { error: reviewDeleteError } = await adminClient
      .from("application_doc_reviews")
      .delete()
      .eq("application_id", app.application_id);
    if (reviewDeleteError) return json({ error: reviewDeleteError.message }, 500);

    const { error: deleteError } = await adminClient
      .from("applications")
      .delete()
      .eq("id", app.id);
    if (deleteError) return json({ error: deleteError.message }, 500);

    return json({
      success: true,
      application_id: app.application_id,
      deleted_storage_files: deletedStorageFiles + explicitPaths.length,
    });
  } catch (err: any) {
    console.error("[delete-application] Error:", err);
    return json({ error: err.message || "Internal server error" }, 500);
  }
});
