/* eslint-disable @typescript-eslint/no-explicit-any */
// Attach a book cover: accepts a base64 image (mobile capture / web upload) OR a source_url
// (auto-fetched from Google Books / Open Library), downscales it, stores it durably in R2, and
// writes the public URL to library_books.cover_url (target=book) or
// library_digitization_records.cover_image_url (target=record).
import { createClient } from "npm:@supabase/supabase-js@2";
import { uploadToR2 } from "../_shared/r2.ts";
import { downscaleForDisplay } from "../_shared/resizeImage.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

function base64ToBytes(input: string): { bytes: Uint8Array; mime: string } {
  const commaIdx = input.indexOf(",");
  const meta = input.startsWith("data:") ? input.slice(5, commaIdx) : "";
  const mime = meta.split(";")[0] || "image/jpeg";
  const b64 = commaIdx >= 0 ? input.slice(commaIdx + 1) : input;
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { bytes, mime };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader) return json({ error: "Not authenticated" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    // Verify the caller is a library operator using their own JWT.
    const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: canOperate, error: permErr } = await userClient.rpc("can_operate_library");
    if (permErr) return json({ error: permErr.message }, 500);
    if (!canOperate) return json({ error: "You do not have permission to manage the library" }, 403);

    const { target, id, image_base64, source_url } = await req.json();
    if (target !== "book" && target !== "record") return json({ error: "target must be 'book' or 'record'" }, 400);
    if (!id) return json({ error: "id is required" }, 400);

    let rawBytes: Uint8Array;
    let mime = "image/jpeg";
    if (typeof image_base64 === "string" && image_base64.length > 0) {
      const decoded = base64ToBytes(image_base64);
      rawBytes = decoded.bytes;
      mime = decoded.mime;
    } else if (typeof source_url === "string" && /^https?:\/\//.test(source_url)) {
      const res = await fetch(source_url);
      if (!res.ok) return json({ error: `Could not fetch source image (${res.status})` }, 400);
      rawBytes = new Uint8Array(await res.arrayBuffer());
      mime = res.headers.get("content-type") || mime;
    } else {
      return json({ error: "Provide image_base64 or a valid source_url" }, 400);
    }
    if (!rawBytes.byteLength) return json({ error: "Empty image" }, 400);
    // Auto-fetched covers: some sources return a tiny "no cover" placeholder (Google ~1.3KB,
    // Open Library 1px ~0.8KB) with HTTP 200. Reject those so we never store a blank cover.
    // Manual uploads (base64) are trusted and skip this guard.
    if (source_url && rawBytes.byteLength < 2500) return json({ error: "No cover available at source" }, 404);

    const { bytes, mimeType } = await downscaleForDisplay(rawBytes, mime);
    const ext = mimeType === "image/png" ? "png" : "jpg";
    const key = `library-covers/${target}/${id}-${Date.now()}.${ext}`;
    const { url } = await uploadToR2({ key, body: bytes, contentType: mimeType, cacheControl: "public, max-age=31536000, immutable" });

    // Write with service role after the permission check above.
    const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { error: updErr } = target === "book"
      ? await admin.from("library_books").update({ cover_url: url }).eq("id", id)
      : await admin.from("library_digitization_records").update({ cover_image_url: url }).eq("id", id);
    if (updErr) return json({ error: updErr.message }, 500);

    return json({ ok: true, url });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "Cover capture failed" }, 500);
  }
});
