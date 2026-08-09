/* eslint-disable @typescript-eslint/no-explicit-any */
// Server-side batch enrichment for the digitization queue. Invoked by pg_cron (x-cron-secret) or
// by a super-admin "Run now" (their JWT). For each never-tried pending record it calls
// library-book-lookup (prefer Open Library — no quota), fills only BLANK fields, stamps
// enrichment_status, and stores a cover in R2. Bounded per run so it stays under the gateway timeout.
import { createClient } from "npm:@supabase/supabase-js@2";
import { uploadToR2 } from "../_shared/r2.ts";
import { downscaleForDisplay } from "../_shared/resizeImage.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};
const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const normalizeIsbn = (v: string) => (v || "").replace(/[^0-9Xx]/g, "");
const CONCURRENCY = 5;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const cronSecret = Deno.env.get("CRON_SECRET") || "";

    // Auth: cron passes x-cron-secret; the UI "Run now" passes a super-admin JWT.
    let allowed = false;
    const headerSecret = req.headers.get("x-cron-secret") || "";
    if (cronSecret && headerSecret === cronSecret) {
      allowed = true;
    } else {
      const authHeader = req.headers.get("Authorization") || "";
      if (authHeader) {
        const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
          global: { headers: { Authorization: authHeader } },
        });
        const { data } = await userClient.rpc("can_operate_library");
        allowed = !!data;
      }
    }
    if (!allowed) return json({ error: "Not authorized" }, 403);

    const body = await req.json().catch(() => ({}));
    const limit = Math.min(Math.max(Number(body?.limit) || 150, 1), 400);
    const admin = createClient(supabaseUrl, serviceKey);

    // Never-tried pending records only (enrichment_status IS NULL).
    const { data: records, error } = await admin
      .from("library_digitization_records")
      .select("id, title, isbn, authors_text, publisher, place, edition, published_year, category, subject, language, cover_image_url, suggested_metadata")
      .in("status", ["captured", "matched", "needs_review"])
      .is("enrichment_status", null)
      .order("created_at", { ascending: true })
      .limit(limit);
    if (error) return json({ error: error.message }, 500);

    const blank = (v: unknown) => v == null || String(v).trim() === "";

    const enrichOne = async (r: any) => {
      const isbn = normalizeIsbn(r.isbn || "");
      const title = (r.title || "").trim();
      if (!isbn && !title) {
        await admin.from("library_digitization_records").update({ enrichment_status: "no_match" }).eq("id", r.id);
        return { matched: false, cover: false };
      }
      const lookup = await fetch(`${supabaseUrl}/functions/v1/library-book-lookup`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${serviceKey}` },
        body: JSON.stringify({
          isbn: isbn || undefined,
          title: title || undefined,
          author: (r.authors_text || "").split(",")[0]?.trim() || undefined,
          prefer: "open_library",
        }),
      }).then((x) => x.json()).catch(() => null);
      const book = lookup?.book;
      if (!book) {
        await admin.from("library_digitization_records").update({ enrichment_status: "no_match" }).eq("id", r.id);
        return { matched: false, cover: false };
      }

      const upd: Record<string, unknown> = { enrichment_status: "enriched", suggested_metadata: { ...(r.suggested_metadata || {}), ...book } };
      const bookIsbn = normalizeIsbn(book.isbn_13 || book.isbn_10 || "");
      if (blank(r.isbn) && bookIsbn) upd.isbn = bookIsbn;
      if (blank(r.title) && book.title) upd.title = book.title;
      if (blank(r.authors_text) && Array.isArray(book.authors) && book.authors.length) upd.authors_text = book.authors.join(", ");
      if (blank(r.publisher) && book.publisher) upd.publisher = book.publisher;
      if (blank(r.category) && book.category) upd.category = book.category;
      if (blank(r.subject) && book.subject) upd.subject = book.subject;
      if (blank(r.language) && book.language) upd.language = book.language;
      if (blank(r.published_year) && book.published_year) upd.published_year = book.published_year;
      await admin.from("library_digitization_records").update(upd).eq("id", r.id);

      // Store a cover into R2 (mirror of library-cover-capture: downscale + reject placeholders).
      let cover = false;
      if (book.cover_url && blank(r.cover_image_url)) {
        try {
          const res = await fetch(book.cover_url);
          if (res.ok) {
            const raw = new Uint8Array(await res.arrayBuffer());
            if (raw.byteLength >= 2500) {
              const { bytes, mimeType } = await downscaleForDisplay(raw, res.headers.get("content-type") || "image/jpeg");
              const key = `library-covers/record/${r.id}-${Date.now()}.${mimeType === "image/png" ? "png" : "jpg"}`;
              const { url } = await uploadToR2({ key, body: bytes, contentType: mimeType, cacheControl: "public, max-age=31536000, immutable" });
              await admin.from("library_digitization_records").update({ cover_image_url: url }).eq("id", r.id);
              cover = true;
            }
          }
        } catch { /* cover is best-effort */ }
      }
      return { matched: true, cover };
    };

    let matched = 0, covers = 0;
    for (let i = 0; i < (records?.length || 0); i += CONCURRENCY) {
      const batch = (records || []).slice(i, i + CONCURRENCY);
      const results = await Promise.allSettled(batch.map(enrichOne));
      for (const res of results) if (res.status === "fulfilled" && res.value.matched) { matched += 1; if (res.value.cover) covers += 1; }
    }

    const { count: remaining } = await admin
      .from("library_digitization_records")
      .select("id", { count: "exact", head: true })
      .in("status", ["captured", "matched", "needs_review"])
      .is("enrichment_status", null);

    return json({ ok: true, processed: records?.length || 0, matched, covers, remaining: remaining ?? null });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : "Batch enrich failed" }, 500);
  }
});
